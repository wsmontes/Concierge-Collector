import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

integrationSuite('draft transition accounting', () => {
  let payload: import('payload').Payload
  let repository: import('../../../src/collections/repository').CollectionRepository
  let enqueueDraftOperation: typeof import('../../../src/operations/enqueue').enqueueDraftOperation
  let applyDraftOperation: typeof import('../../../src/operations/apply-draft-operation').applyDraftOperation
  let collections: import('mongoose').Model<Record<string, unknown>>
  let operations: import('mongoose').Model<Record<string, unknown>>
  let items: import('mongoose').Model<Record<string, unknown>>
  let changes: import('mongoose').Model<Record<string, unknown>>
  let audits: import('mongoose').Model<Record<string, unknown>>
  let jobs: import('mongoose').Model<Record<string, unknown>>

  const resolver = {
    introspectAdmin: async () => undefined,
    resolveCurations: async (ids: string[]) => ({ eligibleIds: ids, rejected: [] }),
  }
  const audit = { actorId: 'admin-1', idempotencyKey: 'create-key', requestId: 'request-1' }

  beforeAll(async () => {
    if (!hasTestMongo) return
    const [{ getPayload }, { default: config }, repositoryModule, enqueueModule, applyModule] = await Promise.all([
      import('payload'), import('../../../payload.config'), import('../../../src/collections/repository'),
      import('../../../src/operations/enqueue'), import('../../../src/operations/apply-draft-operation'),
    ])
    payload = await getPayload({ config })
    repository = repositoryModule.createCollectionRepository(payload)
    enqueueDraftOperation = enqueueModule.enqueueDraftOperation
    applyDraftOperation = applyModule.applyDraftOperation
    collections = payload.db.collections.collections as unknown as import('mongoose').Model<Record<string, unknown>>
    operations = payload.db.collections['collection-operations'] as unknown as import('mongoose').Model<Record<string, unknown>>
    items = payload.db.collections['collection-operation-items'] as unknown as import('mongoose').Model<Record<string, unknown>>
    changes = payload.db.collections['collection-draft-changes'] as unknown as import('mongoose').Model<Record<string, unknown>>
    audits = payload.db.collections['audit-events'] as unknown as import('mongoose').Model<Record<string, unknown>>
    jobs = payload.db.collections['payload-jobs'] as unknown as import('mongoose').Model<Record<string, unknown>>
  })

  afterEach(async () => {
    if (!hasTestMongo) return
    await Promise.all([
      collections.deleteMany({}), operations.deleteMany({}), items.deleteMany({}),
      changes.deleteMany({}), audits.deleteMany({}), jobs.deleteMany({}),
    ])
  })

  afterAll(async () => { if (hasTestMongo) await payload.db.connection.close() })

  test('explicit add, repeated add and inverse remove keep revision and selected count liquid', async () => {
    const collection = await repository.createCollection({ slug: 'transition-counts', title: 'Transition counts' }, audit)
    const dependencies = { resolve: resolver }

    const add = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0,
      curationIds: ['c1'], idempotencyKey: 'transition-add', actorId: 'admin-1', requestId: 'transition-add-request',
    }, dependencies)
    await applyDraftOperation(payload, add.id, 'worker-a', resolver)
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 1, draftSelectedCount: 1 })

    const repeatedAdd = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 1,
      curationIds: ['c1'], idempotencyKey: 'transition-add-repeat', actorId: 'admin-1', requestId: 'transition-add-repeat-request',
    }, dependencies)
    await applyDraftOperation(payload, repeatedAdd.id, 'worker-a', resolver)
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 1, draftSelectedCount: 1 })
    await expect(operations.findById(repeatedAdd.id).lean()).resolves.toMatchObject({ status: 'completed_with_skips' })
    await expect(items.findOne({ operationId: repeatedAdd.id, curationId: 'c1' }).lean()).resolves.toMatchObject({ status: 'skipped', reasonCode: 'no_op' })

    const remove = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'remove', baseDraftRevision: 1,
      curationIds: ['c1'], idempotencyKey: 'transition-remove', actorId: 'admin-1', requestId: 'transition-remove-request',
    }, dependencies)
    await applyDraftOperation(payload, remove.id, 'worker-a', resolver)
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 2, draftSelectedCount: 0 })
    await expect(items.findOne({ operationId: remove.id, curationId: 'c1' }).lean()).resolves.toMatchObject({ status: 'applied' })

    const database = payload.db.connection.db
    if (!database) throw new Error('Mongo database unavailable')
    const { visibleDraftChanges } = await import('../support/collection-fixtures')
    expect(await visibleDraftChanges(database, collection.id)).toEqual([])
  })
})
