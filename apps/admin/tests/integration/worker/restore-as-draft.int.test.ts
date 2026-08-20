import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

integrationSuite('collection restore-as-draft', () => {
  let payload: import('payload').Payload
  let repository: import('../../../src/collections/repository').CollectionRepository
  let enqueueDraftOperation: typeof import('../../../src/operations/enqueue').enqueueDraftOperation
  let applyDraftOperation: typeof import('../../../src/operations/apply-draft-operation').applyDraftOperation
  let enqueuePublish: typeof import('../../../src/publishing/publish-collection').enqueuePublish
  let runPublishJob: typeof import('../../../src/publishing/publish-collection').runPublishJob
  let restoreVersionAsDraft: typeof import('../../../src/publishing/publish-collection').restoreVersionAsDraft
  let collections: import('mongoose').Model<Record<string, unknown>>
  let memberships: import('mongoose').Model<Record<string, unknown>>
  let versions: import('mongoose').Model<Record<string, unknown>>
  let publishJobs: import('mongoose').Model<Record<string, unknown>>
  let payloadJobs: import('mongoose').Model<Record<string, unknown>>
  let operations: import('mongoose').Model<Record<string, unknown>>
  let operationItems: import('mongoose').Model<Record<string, unknown>>
  let changes: import('mongoose').Model<Record<string, unknown>>
  let audits: import('mongoose').Model<Record<string, unknown>>

  const catalog = {
    introspectAdmin: async () => undefined,
    resolveCurations: async (ids: string[]) => ({ eligibleIds: ids, rejected: [] }),
  }
  const availability = {
    introspectAdmin: async () => undefined,
    hydrateCurations: async (ids: string[]) => ({ availableCount: ids.length, unavailableCount: 0 }),
  }
  const audit = { actorId: 'admin-1', idempotencyKey: 'create-key', requestId: 'create-request' }

  async function publishDraft(collectionId: string, key: string): Promise<void> {
    const dirty = await repository.getCollection(collectionId)
    const job = await enqueuePublish(payload, {
      collectionId, ifMatch: dirty.revision, idempotencyKey: `publish-${key}`, requestId: `publish-${key}-request`,
      actorId: 'admin-1', confirmUnavailable: false,
    }, availability)
    await runPublishJob(payload, job.id, `publish-worker-${key}`, availability)
  }

  async function draftChange(collectionId: string, curationId: string, action: 'add' | 'remove', key: string): Promise<void> {
    const current = await repository.getCollection(collectionId)
    const operation = await enqueueDraftOperation(payload, {
      collectionId, action, baseDraftRevision: current.draftRevision, curationIds: [curationId],
      idempotencyKey: `${action}-${key}`, actorId: 'admin-1', requestId: `${action}-${key}-request`,
    }, { resolve: catalog })
    await applyDraftOperation(payload, operation.id, `operation-worker-${key}`, catalog)
  }

  beforeAll(async () => {
    if (!hasTestMongo) return
    const [{ getPayload }, { default: config }, repositoryModule, operationModule, applyModule, publishModule] = await Promise.all([
      import('payload'), import('../../../payload.config'), import('../../../src/collections/repository'),
      import('../../../src/operations/enqueue'), import('../../../src/operations/apply-draft-operation'),
      import('../../../src/publishing/publish-collection'),
    ])
    payload = await getPayload({ config })
    repository = repositoryModule.createCollectionRepository(payload)
    enqueueDraftOperation = operationModule.enqueueDraftOperation
    applyDraftOperation = applyModule.applyDraftOperation
    enqueuePublish = publishModule.enqueuePublish
    runPublishJob = publishModule.runPublishJob
    restoreVersionAsDraft = publishModule.restoreVersionAsDraft
    collections = payload.db.collections.collections as unknown as import('mongoose').Model<Record<string, unknown>>
    memberships = payload.db.collections['collection-memberships'] as unknown as import('mongoose').Model<Record<string, unknown>>
    versions = payload.db.collections['collection-versions'] as unknown as import('mongoose').Model<Record<string, unknown>>
    publishJobs = payload.db.collections['collection-publish-jobs'] as unknown as import('mongoose').Model<Record<string, unknown>>
    payloadJobs = payload.db.collections['payload-jobs'] as unknown as import('mongoose').Model<Record<string, unknown>>
    operations = payload.db.collections['collection-operations'] as unknown as import('mongoose').Model<Record<string, unknown>>
    operationItems = payload.db.collections['collection-operation-items'] as unknown as import('mongoose').Model<Record<string, unknown>>
    changes = payload.db.collections['collection-draft-changes'] as unknown as import('mongoose').Model<Record<string, unknown>>
    audits = payload.db.collections['audit-events'] as unknown as import('mongoose').Model<Record<string, unknown>>
  })

  afterEach(async () => {
    if (!hasTestMongo) return
    await Promise.all([
      collections.deleteMany({}), memberships.deleteMany({}), versions.deleteMany({}), publishJobs.deleteMany({}), payloadJobs.deleteMany({}),
      operations.deleteMany({}), operationItems.deleteMany({}), changes.deleteMany({}), audits.deleteMany({}),
    ])
  })
  afterAll(async () => { if (hasTestMongo) await payload.db.connection.close() })

  test('restores a historical version as draft without moving the published pointer', async () => {
    const collection = await repository.createCollection({ slug: 'restore-historical', title: 'Restore historical' }, audit)
    await draftChange(collection.id, 'c1', 'add', 'r1')
    await publishDraft(collection.id, 'r1')
    await draftChange(collection.id, 'c2', 'add', 'r2')
    await publishDraft(collection.id, 'r2')
    await draftChange(collection.id, 'c3', 'add', 'r3')

    const result = await restoreVersionAsDraft(payload, {
      collectionId: collection.id, version: 1, actorId: 'admin-1', requestId: 'restore-1-request',
    }, { resolve: catalog })

    // Diff v1={c1} against the published base v2={c1,c2}: only c2 must leave the draft.
    expect(result).toMatchObject({
      collectionId: collection.id, restoredVersion: 1, baseVersion: 2, addedCount: 0, removedCount: 1,
    })
    expect(result.operationIds).toHaveLength(1)

    await expect(repository.getCollection(collection.id)).resolves.toMatchObject({
      currentPublishedVersion: 2, lifecycle: 'published', draftState: 'dirty',
    })
    await expect(changes.findOne({ collectionId: collection.id, curationId: 'c2' }).sort({ targetDraftRevision: -1 }).lean())
      .resolves.toMatchObject({ desiredState: 'remove', stageState: 'committed' })
    await expect(audits.findOne({ collectionId: collection.id, eventType: 'collection.historical_version_restored_to_draft' }).lean())
      .resolves.toMatchObject({ metadata: { version: 1, baseVersion: 2 } })

    // Retrying the same restore converges to the same delta instead of failing.
    const retry = await restoreVersionAsDraft(payload, {
      collectionId: collection.id, version: 1, actorId: 'admin-1', requestId: 'restore-1-retry',
    }, { resolve: catalog })
    expect(retry.removedCount).toBe(1)
  })

  test('a later publish after restore creates a new monotonic version', async () => {
    const collection = await repository.createCollection({ slug: 'restore-publish', title: 'Restore publish' }, audit)
    await draftChange(collection.id, 'c1', 'add', 'p1')
    await publishDraft(collection.id, 'p1')
    await draftChange(collection.id, 'c2', 'add', 'p2')
    await publishDraft(collection.id, 'p2')
    await draftChange(collection.id, 'c2', 'remove', 'p3')
    await publishDraft(collection.id, 'p3')
    await expect(repository.getCollection(collection.id)).resolves.toMatchObject({ currentPublishedVersion: 3 })

    const result = await restoreVersionAsDraft(payload, {
      collectionId: collection.id, version: 2, actorId: 'admin-1', requestId: 'restore-2-request',
    }, { resolve: catalog })
    expect(result).toMatchObject({ restoredVersion: 2, baseVersion: 3, addedCount: 1, removedCount: 0 })

    await publishDraft(collection.id, 'p4')
    await expect(repository.getCollection(collection.id)).resolves.toMatchObject({
      currentPublishedVersion: 4, draftState: 'clean', publishedSelectedCount: 2,
    })
    await expect(versions.findOne({ collectionId: collection.id, version: 4 }).lean())
      .resolves.toMatchObject({ status: 'published', selectedCount: 2 })
    await expect(memberships.findOne({ collectionId: collection.id, curationId: 'c2', addedInVersion: 4 }).lean())
      .resolves.toMatchObject({ addedInVersion: 4, removedInVersion: null })
  })

  test('rejects versions that were never published or never existed', async () => {
    const collection = await repository.createCollection({ slug: 'restore-never', title: 'Restore never' }, audit)
    await expect(restoreVersionAsDraft(payload, {
      collectionId: collection.id, version: 1, actorId: 'admin-1', requestId: 'restore-never-request',
    }, { resolve: catalog })).rejects.toMatchObject({ status: 409, code: 'conflict' })

    await draftChange(collection.id, 'c1', 'add', 'n1')
    await publishDraft(collection.id, 'n1')
    await expect(restoreVersionAsDraft(payload, {
      collectionId: collection.id, version: 9, actorId: 'admin-1', requestId: 'restore-missing-request',
    }, { resolve: catalog })).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  test('rejects restore while the draft is locked by an in-flight publish', async () => {
    const collection = await repository.createCollection({ slug: 'restore-locked', title: 'Restore locked' }, audit)
    await draftChange(collection.id, 'c1', 'add', 'l1')
    await publishDraft(collection.id, 'l1')
    const dirty = await repository.getCollection(collection.id)
    await enqueuePublish(payload, {
      collectionId: collection.id, ifMatch: dirty.revision, idempotencyKey: 'publish-lock', requestId: 'publish-lock-request',
      actorId: 'admin-1', confirmUnavailable: false,
    }, availability)
    await expect(restoreVersionAsDraft(payload, {
      collectionId: collection.id, version: 1, actorId: 'admin-1', requestId: 'restore-locked-request',
    }, { resolve: catalog })).rejects.toMatchObject({ status: 423, code: 'draft_locked' })
  })
})
