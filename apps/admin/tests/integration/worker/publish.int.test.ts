import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

integrationSuite('collection publish worker', () => {
  let payload: import('payload').Payload
  let repository: import('../../../src/collections/repository').CollectionRepository
  let enqueueDraftOperation: typeof import('../../../src/operations/enqueue').enqueueDraftOperation
  let applyDraftOperation: typeof import('../../../src/operations/apply-draft-operation').applyDraftOperation
  let enqueuePublish: typeof import('../../../src/publishing/publish-collection').enqueuePublish
  let runPublishJob: typeof import('../../../src/publishing/publish-collection').runPublishJob
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

  beforeAll(async () => {
    if (!hasTestMongo) return
    const [{ getPayload }, { default: config }, repositoryModule, operationModule, applyModule, publishModule] = await Promise.all([
      import('payload'), import('../../../payload.config'), import('../../../src/collections/repository'),
      import('../../../src/operations/enqueue'), import('../../../src/operations/apply-draft-operation'),
      import('../../../src/publishing/publish-collection'),
    ])
    payload = await getPayload({ config })
    repository = repositoryModule.createCollectionRepository(payload)
    enqueueDraftOperation = ((payload, command, deps = {}) =>
      // O worker vivo do stack de qualificação roda payload-jobs a cada
      // minuto; sem suprimir o job, ele roubaria a operação entre o enqueue
      // e o apply manual destes testes (corrida observada no gate).
      operationModule.enqueueDraftOperation(payload, command, { ...deps, createWorkerJob: false })) as typeof operationModule.enqueueDraftOperation
    applyDraftOperation = applyModule.applyDraftOperation
    enqueuePublish = publishModule.enqueuePublish
    runPublishJob = publishModule.runPublishJob
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

  test('promotes a frozen version atomically after the explicit publish command', async () => {
    const collection = await repository.createCollection({ slug: 'publish-first', title: 'Publish first' }, audit)
    const operation = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: ['c1'],
      idempotencyKey: 'add-first', actorId: 'admin-1', requestId: 'add-first-request',
    }, { resolve: catalog })
    await applyDraftOperation(payload, operation.id, 'operation-worker', catalog)
    const dirty = await repository.getCollection(collection.id)
    const command = {
      collectionId: collection.id, ifMatch: dirty.revision, idempotencyKey: 'publish-first', requestId: 'publish-first-request',
      actorId: 'admin-1', confirmUnavailable: false,
    }
    const job = await enqueuePublish(payload, command, availability)
    const retry = await enqueuePublish(payload, command, availability)
    expect(retry.id).toBe(job.id)
    await runPublishJob(payload, job.id, 'publish-worker', availability)

    await expect(repository.getCollection(collection.id)).resolves.toMatchObject({
      lifecycle: 'published', currentPublishedVersion: 1, draftRevision: 0, draftState: 'clean', publishedSelectedCount: 1,
    })
    await expect(versions.findOne({ collectionId: collection.id, version: 1 }).lean()).resolves.toMatchObject({ status: 'published', selectedCount: 1 })
    await expect(memberships.findOne({ collectionId: collection.id, curationId: 'c1' }).lean()).resolves.toMatchObject({ addedInVersion: 1, removedInVersion: null })
    await expect(publishJobs.findById(job.id).lean()).resolves.toMatchObject({ status: 'completed', checkpoint: 'promoted' })
  })

  test('requires an explicit confirmation bound to the observed unavailable count', async () => {
    const collection = await repository.createCollection({ slug: 'publish-unavailable', title: 'Publish unavailable' }, audit)
    const operation = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: ['c1'],
      idempotencyKey: 'add-unavailable', actorId: 'admin-1', requestId: 'add-unavailable-request',
    }, { resolve: catalog })
    await applyDraftOperation(payload, operation.id, 'operation-worker', catalog)
    const dirty = await repository.getCollection(collection.id)
    const unavailable = { introspectAdmin: async () => undefined, hydrateCurations: async () => ({ availableCount: 0, unavailableCount: 1 }) }
    await expect(enqueuePublish(payload, {
      collectionId: collection.id, ifMatch: dirty.revision, idempotencyKey: 'publish-unavailable', requestId: 'publish-unavailable-request',
      actorId: 'admin-1', confirmUnavailable: false,
    }, unavailable)).rejects.toMatchObject({
      status: 409,
      code: 'unavailable_confirmation_required',
      details: { unavailableCount: '1' },
    })
    await expect(enqueuePublish(payload, {
      collectionId: collection.id, ifMatch: dirty.revision, idempotencyKey: 'publish-unavailable-confirmed', requestId: 'publish-unavailable-confirmed-request',
      actorId: 'admin-1', confirmUnavailable: true, expectedUnavailableCount: 1,
    }, unavailable)).resolves.toMatchObject({ status: 'queued', confirmedUnavailableCount: 1 })
  })
})