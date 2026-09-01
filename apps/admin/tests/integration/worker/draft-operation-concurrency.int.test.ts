import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import type { Model } from 'mongoose'
import type { Payload } from 'payload'
import type { Db } from 'mongodb'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

integrationSuite('draft operation concurrency', () => {
  let payload: Payload
  let repository: import('../../../src/collections/repository').CollectionRepository
  let enqueueDraftOperation: typeof import('../../../src/operations/enqueue').enqueueDraftOperation
  let applyDraftOperation: typeof import('../../../src/operations/apply-draft-operation').applyDraftOperation
  let cancelDraftOperation: typeof import('../../../src/operations/apply-draft-operation').cancelDraftOperation
  let collections: Model<Record<string, unknown>>
  let operations: Model<Record<string, unknown>>
  let items: Model<Record<string, unknown>>
  let changes: Model<Record<string, unknown>>
  let audits: Model<Record<string, unknown>>
  let database: Db

  const resolver = {
    introspectAdmin: async () => undefined,
    resolveCurations: async (ids: string[]) => ({ eligibleIds: ids, rejected: [] }),
  }
  const audit = { actorId: 'admin-1', idempotencyKey: 'create-key', requestId: 'request-1' }

  beforeAll(async () => {
    if (!hasTestMongo) return
    const { getSharedPayload } = await import('../support/collection-fixtures')
    payload = await getSharedPayload()
    const repositoryModule = await import('../../../src/collections/repository')
    repository = repositoryModule.createCollectionRepository(payload)
    const enqueueModule = await import('../../../src/operations/enqueue')
    enqueueDraftOperation = ((payload, command, deps = {}) =>
      // O worker vivo do stack de qualificação roda payload-jobs a cada
      // minuto; sem suprimir o job, ele roubaria a operação entre o enqueue
      // e o apply manual destes testes (corrida observada no gate).
      enqueueModule.enqueueDraftOperation(payload, command, { ...deps, createWorkerJob: false })) as typeof enqueueModule.enqueueDraftOperation
    const applyModule = await import('../../../src/operations/apply-draft-operation')
    applyDraftOperation = applyModule.applyDraftOperation
    cancelDraftOperation = applyModule.cancelDraftOperation
    collections = payload.db.collections.collections as unknown as Model<Record<string, unknown>>
    operations = payload.db.collections['collection-operations'] as unknown as Model<Record<string, unknown>>
    items = payload.db.collections['collection-operation-items'] as unknown as Model<Record<string, unknown>>
    changes = payload.db.collections['collection-draft-changes'] as unknown as Model<Record<string, unknown>>
    audits = payload.db.collections['audit-events'] as unknown as Model<Record<string, unknown>>
    const db = payload.db.connection.db
    if (!db) throw new Error('Mongo database unavailable')
    database = db
    // The Payload connection is owned by the shared support module
    // (tests/integration/support/collection-fixtures.ts afterAll).
  })

  afterEach(async () => {
    if (!hasTestMongo) return
    await Promise.all([
      collections.deleteMany({}),
      operations.deleteMany({}),
      items.deleteMany({}),
      changes.deleteMany({}),
      audits.deleteMany({}),
      payload.db.collections['payload-jobs'].deleteMany({}),
      payload.db.collections['collection-publish-jobs'].deleteMany({}),
      payload.db.collections['collection-memberships'].deleteMany({}),
      payload.db.collections['collection-versions'].deleteMany({}),
    ])
  })

  test('add/add concorrente: o CAS de revision serializa e a segunda operacao nunca aplica', async () => {
    const collection = await repository.createCollection({ slug: 'cc-add-add', title: 'Add add' }, audit)
    const first = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: ['c1'],
      idempotencyKey: 'cc-add-add-first', actorId: 'admin-1', requestId: 'cc-add-add-first-request',
    }, { resolve: resolver })
    const second = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: ['c2'],
      idempotencyKey: 'cc-add-add-second', actorId: 'admin-1', requestId: 'cc-add-add-second-request',
    }, { resolve: resolver })

    // Two workers race the queue. `claim` only lets the smallest non-terminal
    // operationSequence proceed (apply-draft-operation.ts `claim`), so the
    // first enqueued operation always commits and the second apply returns
    // null while its operation stays queued.
    const [a, b] = await Promise.all([
      applyDraftOperation(payload, first.id, 'worker-a', resolver),
      applyDraftOperation(payload, second.id, 'worker-b', resolver),
    ])
    expect(a).toMatchObject({ status: 'committed', fencingToken: 1 })
    expect(b).toBeNull()
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 1 })
    await expect(changes.countDocuments({ operationId: first.id, stageState: 'committed' })).resolves.toBe(1)
    const { visibleDraftChanges } = await import('../support/collection-fixtures')
    expect(await visibleDraftChanges(database, collection.id)).toMatchObject([{ curationId: 'c1', desiredState: 'add' }])

    // Retrying the loser is refused by the revision validation before staging:
    // its baseDraftRevision is stale (apply-draft-operation.ts validates
    // `collection.draftRevision !== operation.baseDraftRevision`), so it
    // becomes terminal 'conflicted' without ever writing staging rows.
    await applyDraftOperation(payload, second.id, 'worker-b', resolver)
    await expect(operations.findById(second.id).lean()).resolves.toMatchObject({
      status: 'conflicted', errorCode: 'draft_revision_changed',
    })
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 1 })
    await expect(changes.countDocuments({ operationId: second.id })).resolves.toBe(0)
    expect(await visibleDraftChanges(database, collection.id)).toMatchObject([{ curationId: 'c1', desiredState: 'add' }])
  })

  test('add/remove concorrente: a acao inversa nao desfaz a operacao vencedora sem base valida', async () => {
    const collection = await repository.createCollection({ slug: 'cc-add-remove', title: 'Add remove' }, audit)
    const add = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: ['c1'],
      idempotencyKey: 'cc-add-remove-add', actorId: 'admin-1', requestId: 'cc-add-remove-add-request',
    }, { resolve: resolver })
    const remove = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'remove', baseDraftRevision: 0, curationIds: ['c1'],
      idempotencyKey: 'cc-add-remove-remove', actorId: 'admin-1', requestId: 'cc-add-remove-remove-request',
    }, { resolve: resolver })

    const [a, b] = await Promise.all([
      applyDraftOperation(payload, add.id, 'worker-a', resolver),
      applyDraftOperation(payload, remove.id, 'worker-b', resolver),
    ])
    expect(a).toMatchObject({ status: 'committed' })
    expect(b).toBeNull()
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 1 })
    const { visibleDraftChanges } = await import('../support/collection-fixtures')
    expect(await visibleDraftChanges(database, collection.id)).toMatchObject([{ curationId: 'c1', desiredState: 'add' }])

    // The inverse operation enqueued against the same base revision is stale
    // and never touches the committed delta.
    await applyDraftOperation(payload, remove.id, 'worker-b', resolver)
    await expect(operations.findById(remove.id).lean()).resolves.toMatchObject({ status: 'conflicted', errorCode: 'draft_revision_changed' })
    expect(await visibleDraftChanges(database, collection.id)).toMatchObject([{ curationId: 'c1', desiredState: 'add' }])
  })

  test('remove/remove concorrente: uma so vence e a segunda e rejeitada sem delta', async () => {
    const collection = await repository.createCollection({ slug: 'cc-remove-remove', title: 'Remove remove' }, audit)
    const first = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'remove', baseDraftRevision: 0, curationIds: ['c1'],
      idempotencyKey: 'cc-remove-remove-first', actorId: 'admin-1', requestId: 'cc-remove-remove-first-request',
    }, { resolve: resolver })
    const second = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'remove', baseDraftRevision: 0, curationIds: ['c2'],
      idempotencyKey: 'cc-remove-remove-second', actorId: 'admin-1', requestId: 'cc-remove-remove-second-request',
    }, { resolve: resolver })

    const [a, b] = await Promise.all([
      applyDraftOperation(payload, first.id, 'worker-a', resolver),
      applyDraftOperation(payload, second.id, 'worker-b', resolver),
    ])
    expect(a).toMatchObject({ status: 'committed' })
    expect(b).toBeNull()
    // Removing a non-member converges to no delta, yet the operation still
    // advances the draft revision atomically.
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 1 })
    const { visibleDraftChanges } = await import('../support/collection-fixtures')
    expect(await visibleDraftChanges(database, collection.id)).toEqual([])

    await applyDraftOperation(payload, second.id, 'worker-b', resolver)
    await expect(operations.findById(second.id).lean()).resolves.toMatchObject({ status: 'conflicted', errorCode: 'draft_revision_changed' })
    await expect(changes.countDocuments({ operationId: second.id })).resolves.toBe(0)
  })

  test('stale If-Match: baseDraftRevision antigo e recusado no enqueue com 412', async () => {
    const collection = await repository.createCollection({ slug: 'cc-stale-ifmatch', title: 'Stale ifmatch' }, audit)
    const first = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: ['c1'],
      idempotencyKey: 'cc-stale-ifmatch-first', actorId: 'admin-1', requestId: 'cc-stale-ifmatch-first-request',
    }, { resolve: resolver })
    await applyDraftOperation(payload, first.id, 'worker-a', resolver)
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 1 })

    // The enqueue guard rejects commands whose base revision is behind the
    // current draft (enqueue.ts: `collection.draftRevision !== baseDraftRevision`).
    await expect(enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: ['c2'],
      idempotencyKey: 'cc-stale-ifmatch-stale', actorId: 'admin-1', requestId: 'cc-stale-ifmatch-stale-request',
    }, { resolve: resolver })).rejects.toMatchObject({ status: 412, code: 'revision_conflict' })
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 1 })
  })

  test('retry de lote: mesma idempotency key nao duplica items', async () => {
    const collection = await repository.createCollection({ slug: 'cc-batch-retry', title: 'Batch retry' }, audit)
    const command = {
      collectionId: collection.id, action: 'add' as const, baseDraftRevision: 0,
      curationIds: ['c1', 'c2'], idempotencyKey: 'cc-batch-retry', actorId: 'admin-1', requestId: 'cc-batch-retry-request',
    }
    const first = await enqueueDraftOperation(payload, command, { resolve: resolver })
    await applyDraftOperation(payload, first.id, 'worker-a', resolver)
    await expect(changes.countDocuments({ operationId: first.id, stageState: 'committed' })).resolves.toBe(2)

    // Same key + same payload returns the original record without a new
    // resolution or new rows (enqueue.ts `existingIdempotentOperation`).
    const retry = await enqueueDraftOperation(payload, command, { resolve: resolver })
    expect(retry.id).toBe(first.id)
    await expect(operations.countDocuments({ collectionId: collection.id })).resolves.toBe(1)
    await expect(changes.countDocuments({ operationId: first.id })).resolves.toBe(2)
    await expect(items.countDocuments({ operationId: first.id })).resolves.toBe(2)

    // Same key + different payload is an idempotency conflict.
    await expect(enqueueDraftOperation(payload, { ...command, curationIds: ['c3'] }, { resolve: resolver }))
      .rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' })
  })

  test('crash durante materializing: operacao fica retryable e retoma sem duplicar', async () => {
    const { seedOperation, runUntilCheckpoint, loadCollection } = await import('../support/collection-fixtures')
    const operation = await seedOperation({ curationIds: ['c1'] })
    await expect(runUntilCheckpoint(operation.id, 'materializing')).rejects.toMatchObject({
      status: 503, code: 'authorization_unavailable',
    })
    await expect(operations.findById(operation.id).lean()).resolves.toMatchObject({
      status: 'materializing', checkpoint: 'retryable',
    })
    expect((await loadCollection(database, operation.collectionId))?.draftRevision).toBe(0)

    await applyDraftOperation(payload, operation.id, 'worker-b', resolver)
    expect((await loadCollection(database, operation.collectionId))?.draftRevision).toBe(1)
    await expect(operations.findById(operation.id).lean()).resolves.toMatchObject({ status: 'committed', fencingToken: 2 })
    await expect(audits.countDocuments({ eventKey: `collection.operation_committed:${operation.id}` })).resolves.toBe(1)
  })

  test('crash entre staging e commit: staging fica invisivel e retoma sem duplicar', async () => {
    const { seedOperation, runUntilCheckpoint, loadCollection, visibleDraftChanges } = await import('../support/collection-fixtures')
    const operation = await seedOperation({ curationIds: ['c1', 'c2'] })
    await expect(runUntilCheckpoint(operation.id, 'before_commit')).rejects.toThrow('simulated_crash')
    // The collection pointer never advanced and no staging is visible.
    expect((await loadCollection(database, operation.collectionId))?.draftRevision).toBe(0)
    expect(await visibleDraftChanges(database, operation.collectionId)).toEqual([])
    await expect(operations.findById(operation.id).lean()).resolves.toMatchObject({
      status: 'staging', checkpoint: 'retryable',
    })

    await applyDraftOperation(payload, operation.id, 'worker-b', resolver)
    expect((await loadCollection(database, operation.collectionId))?.draftRevision).toBe(1)
    expect(await visibleDraftChanges(database, operation.collectionId)).toHaveLength(2)
    await expect(operations.findById(operation.id).lean()).resolves.toMatchObject({ status: 'committed', fencingToken: 2 })
    await expect(audits.countDocuments({ eventKey: `collection.operation_committed:${operation.id}` })).resolves.toBe(1)
  })

  test('crash durante committing: novo worker toma o lease e promove uma unica vez', async () => {
    const { seedOperation, loadCollection } = await import('../support/collection-fixtures')
    const operation = await seedOperation({ curationIds: ['c1'] })
    // Simulate a worker that died between entering committing and the CAS.
    await operations.updateOne({ _id: operation.id }, {
      $set: {
        status: 'committing', checkpoint: 'before_commit',
        leaseOwner: 'dead-worker', leaseExpiresAt: new Date(Date.now() - 1_000), fencingToken: 7,
      },
    })

    await applyDraftOperation(payload, operation.id, 'restarted-worker', resolver)
    expect((await loadCollection(database, operation.collectionId))?.draftRevision).toBe(1)
    await expect(operations.findById(operation.id).lean()).resolves.toMatchObject({ status: 'committed', fencingToken: 8 })
    await expect(audits.countDocuments({ eventKey: `collection.operation_committed:${operation.id}` })).resolves.toBe(1)

    // A third worker cannot promote the already committed operation again.
    await expect(applyDraftOperation(payload, operation.id, 'another-worker', resolver)).resolves.toBeNull()
    expect((await loadCollection(database, operation.collectionId))?.draftRevision).toBe(1)
    await expect(audits.countDocuments({ eventKey: `collection.operation_committed:${operation.id}` })).resolves.toBe(1)
  })

  test('fence antigo e rejeitado: o worker que perdeu o lease nao entra em commit', async () => {
    const { seedOperation, loadCollection } = await import('../support/collection-fixtures')
    const operation = await seedOperation({ curationIds: ['c1'] })

    // Worker-a stages and pauses right before committing. Inside the hook its
    // lease expires and worker-b claims the operation with a fresh fence and
    // commits it. Worker-a's continuation then cannot enter committing because
    // `ownedFence` no longer matches (apply-draft-operation.ts `enteringCommit`).
    const result = await applyDraftOperation(payload, operation.id, 'worker-a', resolver, {
      beforeCommitting: async () => {
        await operations.updateOne({ _id: operation.id }, { $set: { leaseExpiresAt: new Date(Date.now() - 1_000) } })
        await applyDraftOperation(payload, operation.id, 'worker-b', resolver)
      },
    })
    expect(result).toMatchObject({ status: 'committed' })
    await expect(operations.findById(operation.id).lean()).resolves.toMatchObject({
      status: 'committed', leaseOwner: 'worker-b', fencingToken: 2,
    })
    expect((await loadCollection(database, operation.collectionId))?.draftRevision).toBe(1)
    await expect(audits.countDocuments({ eventKey: `collection.operation_committed:${operation.id}` })).resolves.toBe(1)
    await expect(changes.countDocuments({ operationId: operation.id, stageState: 'staged' })).resolves.toBe(0)
  })

  test('cancel: operacao ativa vira terminal e nunca aplica', async () => {
    const { seedOperation, loadCollection, visibleDraftChanges } = await import('../support/collection-fixtures')
    const operation = await seedOperation({ curationIds: ['c1'] })
    const cancelled = await cancelDraftOperation(payload, operation.id)
    expect(cancelled).toMatchObject({ status: 'cancelled', fencingToken: 1 })

    // A worker never applies a cancelled command and nothing becomes visible.
    await expect(applyDraftOperation(payload, operation.id, 'worker-a', resolver)).resolves.toBeNull()
    expect((await loadCollection(database, operation.collectionId))?.draftRevision).toBe(0)
    expect(await visibleDraftChanges(database, operation.collectionId)).toEqual([])
    await expect(changes.countDocuments({ operationId: operation.id })).resolves.toBe(0)
    await expect(audits.countDocuments({ eventKey: `collection.operation_committed:${operation.id}` })).resolves.toBe(0)
  })

  test('cancel depois do commit e recusado e nao desfaz a operacao', async () => {
    const collection = await repository.createCollection({ slug: 'cc-cancel-committed', title: 'Cancel committed' }, audit)
    const operation = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: ['c1'],
      idempotencyKey: 'cc-cancel-committed', actorId: 'admin-1', requestId: 'cc-cancel-committed-request',
    }, { resolve: resolver })
    await applyDraftOperation(payload, operation.id, 'worker-a', resolver)
    await expect(cancelDraftOperation(payload, operation.id)).rejects.toMatchObject({ status: 409, code: 'conflict' })
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 1 })
    const { visibleDraftChanges } = await import('../support/collection-fixtures')
    expect(await visibleDraftChanges(database, collection.id)).toMatchObject([{ curationId: 'c1', desiredState: 'add' }])
  })

  test('cancel de uma operacao nao afeta operacoes vizinhas em fila', async () => {
    const collection = await repository.createCollection({ slug: 'cc-cancel-neighbor', title: 'Cancel neighbor' }, audit)
    const first = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: ['c1'],
      idempotencyKey: 'cc-cancel-neighbor-first', actorId: 'admin-1', requestId: 'cc-cancel-neighbor-first-request',
    }, { resolve: resolver })
    const second = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: ['c2'],
      idempotencyKey: 'cc-cancel-neighbor-second', actorId: 'admin-1', requestId: 'cc-cancel-neighbor-second-request',
    }, { resolve: resolver })

    await cancelDraftOperation(payload, second.id)
    await applyDraftOperation(payload, first.id, 'worker-a', resolver)
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 1 })
    const { visibleDraftChanges } = await import('../support/collection-fixtures')
    expect(await visibleDraftChanges(database, collection.id)).toMatchObject([{ curationId: 'c1', desiredState: 'add' }])
    await expect(operations.findById(second.id).lean()).resolves.toMatchObject({ status: 'cancelled' })
  })
})
