import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import type { Model } from 'mongoose'
import type { Payload } from 'payload'
import { AdminHttpError } from '../../../src/http/errors'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

integrationSuite('publish retry staging isolation', () => {
  let payload: Payload
  let repository: import('../../../src/collections/repository').CollectionRepository
  let enqueueDraftOperation: typeof import('../../../src/operations/enqueue').enqueueDraftOperation
  let applyDraftOperation: typeof import('../../../src/operations/apply-draft-operation').applyDraftOperation
  let enqueuePublish: typeof import('../../../src/publishing/publish-collection').enqueuePublish
  let runPublishJob: typeof import('../../../src/publishing/publish-collection').runPublishJob
  let collections: Model<Record<string, unknown>>
  let memberships: Model<Record<string, unknown>>
  let versions: Model<Record<string, unknown>>
  let publishJobs: Model<Record<string, unknown>>
  let operations: Model<Record<string, unknown>>
  let changes: Model<Record<string, unknown>>
  let audits: Model<Record<string, unknown>>

  const catalog = {
    introspectAdmin: async () => undefined,
    resolveCurations: async (ids: string[]) => ({ eligibleIds: ids, rejected: [] }),
  }
  const availability = {
    introspectAdmin: async () => undefined,
    hydrateCurations: async (ids: string[]) => ({ availableCount: ids.length, unavailableCount: 0 }),
  }
  const audit = { actorId: 'admin-1', idempotencyKey: 'create-key', requestId: 'create-request' }

  beforeAll(async () => {
    if (!hasTestMongo) return
    const { getSharedPayload } = await import('../support/collection-fixtures')
    payload = await getSharedPayload()
    repository = (await import('../../../src/collections/repository')).createCollectionRepository(payload)
    const operationModule = await import('../../../src/operations/enqueue')
    enqueueDraftOperation = ((currentPayload, command, deps = {}) =>
      operationModule.enqueueDraftOperation(currentPayload, command, { ...deps, createWorkerJob: false })) as typeof operationModule.enqueueDraftOperation
    applyDraftOperation = (await import('../../../src/operations/apply-draft-operation')).applyDraftOperation
    const publishModule = await import('../../../src/publishing/publish-collection')
    enqueuePublish = publishModule.enqueuePublish
    runPublishJob = publishModule.runPublishJob
    collections = payload.db.collections.collections as unknown as Model<Record<string, unknown>>
    memberships = payload.db.collections['collection-memberships'] as unknown as Model<Record<string, unknown>>
    versions = payload.db.collections['collection-versions'] as unknown as Model<Record<string, unknown>>
    publishJobs = payload.db.collections['collection-publish-jobs'] as unknown as Model<Record<string, unknown>>
    operations = payload.db.collections['collection-operations'] as unknown as Model<Record<string, unknown>>
    changes = payload.db.collections['collection-draft-changes'] as unknown as Model<Record<string, unknown>>
    audits = payload.db.collections['audit-events'] as unknown as Model<Record<string, unknown>>
  })

  afterEach(async () => {
    if (!hasTestMongo) return
    await Promise.all([
      collections.deleteMany({}), memberships.deleteMany({}), versions.deleteMany({}), publishJobs.deleteMany({}),
      payload.db.collections['payload-jobs'].deleteMany({}), operations.deleteMany({}),
      payload.db.collections['collection-operation-items'].deleteMany({}), changes.deleteMany({}), audits.deleteMany({}),
    ])
  })

  test('a new publish of the same target version cannot inherit staging from a failed publish', async () => {
    const collection = await repository.createCollection({ slug: 'retry-staging', title: 'Retry staging' }, audit)
    const add = await enqueueDraftOperation(payload, {
      collectionId: collection.id,
      action: 'add',
      baseDraftRevision: 0,
      curationIds: ['c1'],
      idempotencyKey: 'retry-staging-add',
      actorId: 'admin-1',
      requestId: 'retry-staging-add-request',
    }, { resolve: catalog })
    await applyDraftOperation(payload, add.id, 'operation-worker', catalog)

    const firstDraft = await repository.getCollection(collection.id)
    const firstPublish = await enqueuePublish(payload, {
      collectionId: collection.id,
      ifMatch: firstDraft.revision,
      idempotencyKey: 'retry-staging-publish-1',
      requestId: 'retry-staging-publish-1-request',
      actorId: 'admin-1',
      confirmUnavailable: false,
    }, availability)

    let introspections = 0
    const revokedAfterStaging = {
      hydrateCurations: availability.hydrateCurations,
      introspectAdmin: async () => {
        introspections += 1
        if (introspections === 2) throw new AdminHttpError(403, 'authorization_revoked')
      },
    }
    const failed = await runPublishJob(payload, firstPublish.id, 'publish-worker-1', revokedAfterStaging)
    expect(failed).toMatchObject({ status: 'authorization_revoked' })
    await expect(memberships.findOne({ collectionId: collection.id, curationId: 'c1' }).lean()).resolves.toMatchObject({ addedInVersion: 1 })
    await expect(versions.findOne({ collectionId: collection.id, version: 1 }).lean()).resolves.toMatchObject({ status: 'ready' })

    const released = await repository.getCollection(collection.id)
    const cancelAdd = await enqueueDraftOperation(payload, {
      collectionId: collection.id,
      action: 'remove',
      baseDraftRevision: released.draftRevision,
      curationIds: ['c1'],
      idempotencyKey: 'retry-staging-remove',
      actorId: 'admin-1',
      requestId: 'retry-staging-remove-request',
    }, { resolve: catalog })
    await applyDraftOperation(payload, cancelAdd.id, 'operation-worker', catalog)

    const emptyDraft = await repository.getCollection(collection.id)
    expect(emptyDraft.draftSelectedCount).toBe(0)
    const secondPublish = await enqueuePublish(payload, {
      collectionId: collection.id,
      ifMatch: emptyDraft.revision,
      idempotencyKey: 'retry-staging-publish-2',
      requestId: 'retry-staging-publish-2-request',
      actorId: 'admin-1',
      confirmUnavailable: false,
    }, availability)
    const completed = await runPublishJob(payload, secondPublish.id, 'publish-worker-2', availability)

    expect(completed).toMatchObject({ status: 'completed', selectedCount: 0 })
    await expect(repository.getCollection(collection.id)).resolves.toMatchObject({
      currentPublishedVersion: 1,
      publishedSelectedCount: 0,
      draftSelectedCount: 0,
    })
    await expect(memberships.countDocuments({ collectionId: collection.id })).resolves.toBe(0)
    await expect(versions.findOne({ collectionId: collection.id, version: 1 }).lean()).resolves.toMatchObject({
      status: 'published',
      selectedCount: 0,
      publicationJobId: secondPublish.id,
    })
  })
})
