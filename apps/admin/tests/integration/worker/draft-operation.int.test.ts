import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

integrationSuite('draft operation worker', () => {
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
    vi.restoreAllMocks()
    if (!hasTestMongo) return
    await Promise.all([collections.deleteMany({}), operations.deleteMany({}), items.deleteMany({}), changes.deleteMany({}), audits.deleteMany({}), jobs.deleteMany({})])
  })

  afterAll(async () => { if (hasTestMongo) await payload.db.connection.close() })

  test('persists request correlation, operation items and a durable worker job before returning a command', async () => {
    const collection = await repository.createCollection({ slug: 'draft-operation', title: 'Draft operation' }, audit)
    const command = {
      collectionId: collection.id, action: 'add' as const, baseDraftRevision: 0,
      curationIds: ['c1', 'c2'], idempotencyKey: 'operation-key', actorId: 'admin-1', requestId: 'operation-request',
    }
    const dependencies = { resolve: resolver }
    const first = await enqueueDraftOperation(payload, command, dependencies)
    const retry = await enqueueDraftOperation(payload, command, dependencies)
    expect(retry.id).toBe(first.id)
    await expect(enqueueDraftOperation(payload, { ...command, curationIds: ['c3'] }, dependencies))
      .rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' })

    await applyDraftOperation(payload, first.id, 'worker-a', resolver)
    const reloaded = await repository.getCollection(collection.id)
    expect(reloaded.draftRevision).toBe(1)
    await expect(changes.countDocuments({ operationId: first.id, targetDraftRevision: 1 })).resolves.toBe(2)
    await expect(operations.findById(first.id).lean()).resolves.toMatchObject({ status: 'committed', fencingToken: 1 })
    await expect(audits.findOne({ eventKey: `collection.operation_committed:${first.id}` }).lean()).resolves.toMatchObject({
      operationId: first.id,
      requestId: 'operation-request',
    })
    await expect(jobs.findOne({ taskSlug: 'apply-draft-operation', 'input.operationId': first.id }).lean()).resolves.toBeTruthy()
  })

  test('takes over an expired committing operation without promoting its collection twice', async () => {
    const collection = await repository.createCollection({ slug: 'restart-operation', title: 'Restart operation' }, audit)
    const command = {
      collectionId: collection.id, action: 'add' as const, baseDraftRevision: 0,
      curationIds: ['c1'], idempotencyKey: 'restart-key', actorId: 'admin-1', requestId: 'restart-request',
    }
    const operation = await enqueueDraftOperation(payload, command, { resolve: resolver })

    await operations.updateOne({ _id: operation.id }, {
      $set: {
        status: 'committing',
        checkpoint: 'before_commit',
        leaseOwner: 'dead-worker',
        leaseExpiresAt: new Date(Date.now() - 1_000),
        fencingToken: 7,
      },
    })

    await applyDraftOperation(payload, operation.id, 'restarted-worker', resolver)
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 1 })
    await expect(operations.findById(operation.id).lean()).resolves.toMatchObject({ status: 'committed', fencingToken: 8 })
    await expect(audits.countDocuments({ eventKey: `collection.operation_committed:${operation.id}` })).resolves.toBe(1)

    await applyDraftOperation(payload, operation.id, 'another-worker', resolver)
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 1 })
    await expect(audits.countDocuments({ eventKey: `collection.operation_committed:${operation.id}` })).resolves.toBe(1)
  })

  test('keeps only the liquid draft delta after an inverse operation', async () => {
    const collection = await repository.createCollection({ slug: 'liquid-delta', title: 'Liquid delta' }, audit)
    const dependencies = { resolve: resolver }
    const added = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0,
      curationIds: ['c1'], idempotencyKey: 'liquid-add', actorId: 'admin-1', requestId: 'liquid-add-request',
    }, dependencies)
    await applyDraftOperation(payload, added.id, 'worker-a', resolver)

    const removed = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'remove', baseDraftRevision: 1,
      curationIds: ['c1'], idempotencyKey: 'liquid-remove', actorId: 'admin-1', requestId: 'liquid-remove-request',
    }, dependencies)
    await applyDraftOperation(payload, removed.id, 'worker-a', resolver)

    const { visibleDraftChanges } = await import('../support/collection-fixtures')
    const database = payload.db.connection.db
    if (!database) throw new Error('Mongo database unavailable')
    expect(await visibleDraftChanges(database, collection.id)).toEqual([])
    await expect(changes.findOne({ operationId: added.id, curationId: 'c1' }).lean()).resolves.toMatchObject({
      validUntilDraftRevision: 1,
    })

    const readded = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 2,
      curationIds: ['c1'], idempotencyKey: 'liquid-readd', actorId: 'admin-1', requestId: 'liquid-readd-request',
    }, dependencies)
    await applyDraftOperation(payload, readded.id, 'worker-a', resolver)
    expect(await visibleDraftChanges(database, collection.id)).toMatchObject([{ operationId: readded.id, desiredState: 'add' }])
  })

  test('does not let authorization-revoked staging alter a later committed operation', async () => {
    const collection = await repository.createCollection({ slug: 'isolated-staging', title: 'Isolated staging' }, audit)
    let introspections = 0
    const revokedAfterStaging = {
      resolveCurations: resolver.resolveCurations,
      introspectAdmin: async () => {
        introspections += 1
        if (introspections === 2) {
          const { AdminHttpError } = await import('../../../src/http/errors')
          throw new AdminHttpError(403, 'authorization_revoked')
        }
      },
    }
    const staged = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0,
      curationIds: ['c1'], idempotencyKey: 'isolated-staging-first', actorId: 'admin-1', requestId: 'isolated-staging-first-request',
    }, { resolve: resolver })
    await applyDraftOperation(payload, staged.id, 'worker-a', revokedAfterStaging)
    await expect(operations.findById(staged.id).lean()).resolves.toMatchObject({ status: 'authorization_revoked' })
    await expect(changes.countDocuments({ operationId: staged.id, stageState: 'staged' })).resolves.toBe(0)

    const later = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0,
      curationIds: ['c1'], idempotencyKey: 'isolated-staging-later', actorId: 'admin-1', requestId: 'isolated-staging-later-request',
    }, { resolve: resolver })
    await applyDraftOperation(payload, later.id, 'worker-b', resolver)

    const database = payload.db.connection.db
    if (!database) throw new Error('Mongo database unavailable')
    const { visibleDraftChanges } = await import('../support/collection-fixtures')
    expect(await visibleDraftChanges(database, collection.id)).toMatchObject([{ operationId: later.id, desiredState: 'add' }])
  })

  test('does not invalidate a committed delta when a later staged operation fails', async () => {
    const collection = await repository.createCollection({ slug: 'committed-delta-isolated', title: 'Committed delta isolated' }, audit)
    const first = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0,
      curationIds: ['c1'], idempotencyKey: 'committed-delta-first', actorId: 'admin-1', requestId: 'committed-delta-first-request',
    }, { resolve: resolver })
    await applyDraftOperation(payload, first.id, 'worker-a', resolver)

    let introspections = 0
    const revokedAfterStaging = {
      resolveCurations: resolver.resolveCurations,
      introspectAdmin: async () => {
        introspections += 1
        if (introspections === 2) {
          const { AdminHttpError } = await import('../../../src/http/errors')
          throw new AdminHttpError(403, 'authorization_revoked')
        }
      },
    }
    const failed = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'remove', baseDraftRevision: 1,
      curationIds: ['c1'], idempotencyKey: 'committed-delta-failed', actorId: 'admin-1', requestId: 'committed-delta-failed-request',
    }, { resolve: resolver })
    await applyDraftOperation(payload, failed.id, 'worker-a', revokedAfterStaging)

    const later = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 1,
      curationIds: ['c2'], idempotencyKey: 'committed-delta-later', actorId: 'admin-1', requestId: 'committed-delta-later-request',
    }, { resolve: resolver })
    await applyDraftOperation(payload, later.id, 'worker-b', resolver)

    const database = payload.db.connection.db
    if (!database) throw new Error('Mongo database unavailable')
    const { visibleDraftChanges } = await import('../support/collection-fixtures')
    expect(await visibleDraftChanges(database, collection.id)).toMatchObject([
      { operationId: first.id, curationId: 'c1', desiredState: 'add' },
      { operationId: later.id, curationId: 'c2', desiredState: 'add' },
    ])
  })

  test('cancellation fences a worker before it can enter committing', async () => {
    const collection = await repository.createCollection({ slug: 'cancel-fence', title: 'Cancel fence' }, audit)
    const operation = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0,
      curationIds: ['c1'], idempotencyKey: 'cancel-fence', actorId: 'admin-1', requestId: 'cancel-fence-request',
    }, { resolve: resolver })
    const { cancelDraftOperation } = await import('../../../src/operations/apply-draft-operation')

    await applyDraftOperation(payload, operation.id, 'worker-a', resolver, {
      beforeCommitting: async () => { await cancelDraftOperation(payload, operation.id) },
    })

    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 0 })
    await expect(operations.findById(operation.id).lean()).resolves.toMatchObject({ status: 'cancelled' })
    await expect(changes.countDocuments({ operationId: operation.id, stageState: 'staged' })).resolves.toBe(0)
  })

  test('rethrows transient failures without terminalizing the operation', async () => {
    const collection = await repository.createCollection({ slug: 'retryable-operation', title: 'Retryable operation' }, audit)
    const operation = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0,
      curationIds: ['c1'], idempotencyKey: 'retryable-operation', actorId: 'admin-1', requestId: 'retryable-operation-request',
    }, { resolve: resolver })
    const { AdminHttpError } = await import('../../../src/http/errors')
    const unavailable = {
      resolveCurations: resolver.resolveCurations,
      introspectAdmin: async () => { throw new AdminHttpError(503, 'authorization_unavailable') },
    }

    await expect(applyDraftOperation(payload, operation.id, 'worker-a', unavailable)).rejects.toMatchObject({
      status: 503,
      code: 'authorization_unavailable',
    })
    await expect(operations.findById(operation.id).lean()).resolves.toMatchObject({ status: 'materializing' })
  })

  test('Payload retries a transient task failure and commits on runByID recovery', async () => {
    const collection = await repository.createCollection({ slug: 'payload-task-retry', title: 'Payload task retry' }, audit)
    const operation = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0,
      curationIds: ['c1'], idempotencyKey: 'payload-task-retry', actorId: 'admin-1', requestId: 'payload-task-retry-request',
    }, { resolve: resolver })

    let failResolve = true
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v3/auth/cms/introspect')) {
        return new Response(JSON.stringify({ authorized: true, role: 'admin' }), { status: 200 })
      }
      if (url.endsWith('/api/v3/catalog/curations/resolve')) {
        if (failResolve) return new Response('temporary outage', { status: 503 })
        return new Response(JSON.stringify({ eligible_ids: ['c1'], rejected: [] }), { status: 200 })
      }
      throw new Error(`Unexpected worker request: ${url}`)
    })

    await payload.jobs.runByID({ id: operation.jobId, overrideAccess: true, silent: true })
    await expect(operations.findById(operation.id).lean()).resolves.toMatchObject({
      status: 'materializing', checkpoint: 'retryable',
    })
    await expect(jobs.findById(operation.jobId).lean()).resolves.toMatchObject({ totalTried: 1, processing: false })

    failResolve = false
    await payload.jobs.runByID({ id: operation.jobId, overrideAccess: true, silent: true })

    await expect(operations.findById(operation.id).lean()).resolves.toMatchObject({ status: 'committed' })
    // Payload deletes successfully completed jobs by default
    // (`jobs.deleteJobOnComplete: true` in payload 3.86 defaults) — the
    // committed operation is the durable evidence that the retry landed.
    await expect(jobs.findById(operation.jobId).lean()).resolves.toBeNull()
  })

  test('forward migration marks pre-staging deltas committed before workers filter them', async () => {
    const legacy = await changes.create({
      collectionId: 'legacy-collection', curationId: 'legacy-curation', desiredState: 'add',
      draftEpoch: 'legacy-epoch', baseDraftRevision: 0, targetDraftRevision: 1,
      operationId: 'legacy-operation', operationSequence: 1,
    })
    // Bypass the current schema to reproduce rows written before stageState
    // existed, then invoke only the forward migration under a Mongo session.
    await changes.collection.updateOne({ _id: legacy._id }, { $unset: { stageState: '' } })
    const { up } = await import('../../../src/migrations/20260819_002_operation_staging')
    const session = await payload.db.connection.startSession()
    try {
      await up({ payload, session } as never)
    } finally {
      await session.endSession()
    }

    await expect(changes.findById(legacy._id).lean()).resolves.toMatchObject({ stageState: 'committed' })
    const indexNames = (await changes.collection.listIndexes().toArray()).map((index) => index.name)
    expect(indexNames).toContain('draft_changes_by_stage')
    const operationIndex = await operations.collection.indexes()
    expect(operationIndex).toContainEqual(expect.objectContaining({ name: 'operation_job_unique', unique: true }))
  })

  test('refuses queued and in-flight draft mutations after the collection is archived', async () => {
    const collection = await repository.createCollection({ slug: 'archive-kill-switch', title: 'Archive kill switch' }, audit)
    const dependencies = { resolve: resolver }
    const operation = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0,
      curationIds: ['c1'], idempotencyKey: 'archive-existing', actorId: 'admin-1', requestId: 'archive-existing-request',
    }, dependencies)
    await collections.updateOne({ _id: collection.id }, { $set: { lifecycle: 'archived' } })

    await expect(enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0,
      curationIds: ['c2'], idempotencyKey: 'archive-new', actorId: 'admin-1', requestId: 'archive-new-request',
    }, dependencies)).rejects.toMatchObject({ status: 409, code: 'conflict' })

    await applyDraftOperation(payload, operation.id, 'worker-a', resolver)
    expect(await repository.getCollection(collection.id)).toMatchObject({ draftRevision: 0, lifecycle: 'archived' })
    await expect(operations.findById(operation.id).lean()).resolves.toMatchObject({ status: 'stale', errorCode: 'collection_archived' })
  })
})
