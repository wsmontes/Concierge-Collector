import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { Types, type Model } from 'mongoose'
import type { Payload } from 'payload'
import type { Db } from 'mongodb'
import { AdminHttpError } from '../../../src/http/errors'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

integrationSuite('collection publish concurrency', () => {
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
  let database: Db

  const catalog = {
    introspectAdmin: async () => undefined,
    resolveCurations: async (ids: string[]) => ({ eligibleIds: ids, rejected: [] }),
  }
  const availability = {
    introspectAdmin: async () => undefined,
    hydrateCurations: async (ids: string[]) => ({ availableCount: ids.length, unavailableCount: 0 }),
  }
  const audit = { actorId: 'admin-1', idempotencyKey: 'create-key', requestId: 'create-request' }

  /** Creates a collection, commits one add and returns the dirty record. */
  async function dirtyCollection(slug: string, keyPrefix: string) {
    const collection = await repository.createCollection({ slug, title: slug }, audit)
    const operation = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: ['c1'],
      idempotencyKey: `${keyPrefix}-add`, actorId: 'admin-1', requestId: `${keyPrefix}-add-request`,
    }, { resolve: catalog })
    await applyDraftOperation(payload, operation.id, 'operation-worker', catalog)
    return repository.getCollection(collection.id)
  }

  /** Dirty draft -> enqueued publish job. Returns the pre-enqueue revision so
   *  callers can retry the exact same command (enqueuePublish increments the
   *  collection revision while locking, so re-reading it changes requestHash). */
  async function publishTarget(slug: string, keyPrefix: string) {
    const dirty = await dirtyCollection(slug, keyPrefix)
    const ifMatch = dirty.revision
    const job = await enqueuePublish(payload, {
      collectionId: dirty.id, ifMatch,
      idempotencyKey: `${keyPrefix}-pub`, requestId: `${keyPrefix}-pub-request`,
      actorId: 'admin-1', confirmUnavailable: false,
    }, availability)
    return { collectionId: dirty.id, job, ifMatch }
  }

  beforeAll(async () => {
    if (!hasTestMongo) return
    const { getSharedPayload } = await import('../support/collection-fixtures')
    payload = await getSharedPayload()
    const repositoryModule = await import('../../../src/collections/repository')
    repository = repositoryModule.createCollectionRepository(payload)
    const operationModule = await import('../../../src/operations/enqueue')
    enqueueDraftOperation = operationModule.enqueueDraftOperation
    const applyModule = await import('../../../src/operations/apply-draft-operation')
    applyDraftOperation = applyModule.applyDraftOperation
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
      memberships.deleteMany({}),
      versions.deleteMany({}),
      publishJobs.deleteMany({}),
      payload.db.collections['payload-jobs'].deleteMany({}),
      operations.deleteMany({}),
      payload.db.collections['collection-operation-items'].deleteMany({}),
      changes.deleteMany({}),
      audits.deleteMany({}),
    ])
  })

  test('dois publishes: somente um vence o lock e a promocao atomicamente', async () => {
    const { collectionId, job, ifMatch } = await publishTarget('cc-two-publishes', 'cc-two-publishes')

    // A retry with the same idempotency key returns the same job (requestHash
    // covers ifMatch, so the exact original command must be repeated).
    const retry = await enqueuePublish(payload, {
      collectionId, ifMatch, idempotencyKey: 'cc-two-publishes-pub',
      requestId: 'cc-two-publishes-pub-request', actorId: 'admin-1', confirmUnavailable: false,
    }, availability)
    expect(retry.id).toBe(job.id)

    // While the draft is locked, any new publish key is refused with 423.
    await expect(enqueuePublish(payload, {
      collectionId, ifMatch, idempotencyKey: 'cc-two-publishes-locked',
      requestId: 'cc-two-publishes-locked-request', actorId: 'admin-1', confirmUnavailable: false,
    }, availability)).rejects.toMatchObject({ status: 423, code: 'draft_locked' })

    // Two workers racing the same job: exactly one claims and promotes.
    const [a, b] = await Promise.all([
      runPublishJob(payload, job.id, 'publish-worker-a', availability),
      runPublishJob(payload, job.id, 'publish-worker-b', availability),
    ])
    const completed = [a, b].filter((result) => result !== null)
    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({ status: 'completed', checkpoint: 'promoted', fencingToken: 1 })
    await expect(repository.getCollection(collectionId)).resolves.toMatchObject({
      lifecycle: 'published', currentPublishedVersion: 1, draftState: 'clean', publishedSelectedCount: 1,
    })
    await expect(memberships.findOne({ collectionId, curationId: 'c1' }).lean()).resolves.toMatchObject({
      addedInVersion: 1, removedInVersion: null,
    })
    await expect(audits.countDocuments({ eventKey: `collection.published:${job.id}` })).resolves.toBe(1)

    // After the promotion, a publish bound to the pre-publish revision is stale.
    await expect(enqueuePublish(payload, {
      collectionId, ifMatch, idempotencyKey: 'cc-two-publishes-stale',
      requestId: 'cc-two-publishes-stale-request', actorId: 'admin-1', confirmUnavailable: false,
    }, availability)).rejects.toMatchObject({ status: 412, code: 'revision_conflict' })
  })

  test('pending operation bloqueia o publish ate a operacao terminar', async () => {
    const collection = await repository.createCollection({ slug: 'cc-pending-op', title: 'Pending op' }, audit)
    const operation = await enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: ['c1'],
      idempotencyKey: 'cc-pending-op-add', actorId: 'admin-1', requestId: 'cc-pending-op-add-request',
    }, { resolve: catalog })
    const clean = await repository.getCollection(collection.id)

    // A queued (non-terminal) operation blocks the publish command entirely
    // (publish-collection.ts `enqueuePublish` refuses non-terminal operations).
    await expect(enqueuePublish(payload, {
      collectionId: collection.id, ifMatch: clean.revision, idempotencyKey: 'cc-pending-op-pub',
      requestId: 'cc-pending-op-pub-request', actorId: 'admin-1', confirmUnavailable: false,
    }, availability)).rejects.toMatchObject({ status: 409, code: 'conflict' })
    await expect(publishJobs.countDocuments({ collectionId: collection.id })).resolves.toBe(0)

    // Once the operation commits, the same publish command succeeds.
    await applyDraftOperation(payload, operation.id, 'operation-worker', catalog)
    const dirty = await repository.getCollection(collection.id)
    const job = await enqueuePublish(payload, {
      collectionId: collection.id, ifMatch: dirty.revision, idempotencyKey: 'cc-pending-op-pub',
      requestId: 'cc-pending-op-pub-request', actorId: 'admin-1', confirmUnavailable: false,
    }, availability)
    expect(job.status).toBe('queued')

    // While the publish holds the draft, new operations are refused with 423
    // and the blocking job id (enqueue.ts `draftLockedError`).
    await expect(enqueueDraftOperation(payload, {
      collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: ['c2'],
      idempotencyKey: 'cc-pending-op-late', actorId: 'admin-1', requestId: 'cc-pending-op-late-request',
    }, { resolve: catalog })).rejects.toMatchObject({ status: 423, code: 'draft_locked', details: { blockingJobId: job.id } })
  })

  test('role revogada na primeira revalidacao aborta o job e libera o draft', async () => {
    const { collectionId, job } = await publishTarget('cc-role-revoked-first', 'cc-role-revoked-first')
    const revoked = {
      hydrateCurations: availability.hydrateCurations,
      introspectAdmin: async () => { throw new AdminHttpError(403, 'authorization_revoked') },
    }
    // 403 before any work: the job is terminal and the draft lock is released
    // back to 'dirty' (publish-collection.ts terminal catch).
    const result = await runPublishJob(payload, job.id, 'publish-worker', revoked)
    expect(result).toMatchObject({ status: 'authorization_revoked', checkpoint: 'authorization_revoked' })
    const released = await repository.getCollection(collectionId)
    // The pointer is absent before any promotion (stored field, not null).
    expect(released.currentPublishedVersion).toBeUndefined()
    expect(released).toMatchObject({ draftState: 'dirty' })
    await expect(versions.countDocuments({ collectionId })).resolves.toBe(0)
    await expect(memberships.countDocuments({ collectionId })).resolves.toBe(0)
    await expect(audits.countDocuments({ eventKey: `collection.published:${job.id}` })).resolves.toBe(0)
  })

  test('role revogada apos staging nao promove o intervalo nem a versao', async () => {
    const { collectionId, job } = await publishTarget('cc-role-revoked-later', 'cc-role-revoked-later')
    let introspections = 0
    const revokedLater = {
      hydrateCurations: availability.hydrateCurations,
      introspectAdmin: async () => {
        introspections += 1
        if (introspections === 2) throw new AdminHttpError(403, 'authorization_revoked')
      },
    }
    // The second revalidation (right before the promotion transaction) fails,
    // so the interval and the 'ready' version exist but are never promoted.
    const result = await runPublishJob(payload, job.id, 'publish-worker', revokedLater)
    expect(result).toMatchObject({ status: 'authorization_revoked' })
    const released = await repository.getCollection(collectionId)
    // The pointer is absent before any promotion (stored field, not null).
    expect(released.currentPublishedVersion).toBeUndefined()
    expect(released).toMatchObject({ draftState: 'dirty', draftRevision: 1 })
    await expect(memberships.findOne({ collectionId, curationId: 'c1' }).lean()).resolves.toMatchObject({ addedInVersion: 1 })
    await expect(versions.findOne({ collectionId, version: 1 }).lean()).resolves.toMatchObject({ status: 'ready' })
    await expect(audits.countDocuments({ eventKey: `collection.published:${job.id}` })).resolves.toBe(0)
  })

  test('takeover apos lease expirada promove uma unica vez e o fence antigo e rejeitado', async () => {
    const { collectionId, job } = await publishTarget('cc-lease-takeover', 'cc-lease-takeover')
    let introspections = 0
    const takeoverClient = {
      hydrateCurations: availability.hydrateCurations,
      introspectAdmin: async () => {
        introspections += 1
        if (introspections === 2) {
          // Worker-a is about to enter the promotion transaction with its own
          // fence; expire its lease so worker-b can take the job over.
          await publishJobs.updateOne({ _id: job.id }, { $set: { leaseExpiresAt: new Date(Date.now() - 1_000) } })
          await runPublishJob(payload, job.id, 'publish-worker-b', availability)
        }
      },
    }
    const result = await runPublishJob(payload, job.id, 'publish-worker-a', takeoverClient)
    // Worker-a's fence was taken before its transaction; the engine returns
    // the terminal record instead of double-promoting (publish-collection.ts
    // `assertFence` inside the promotion transaction).
    expect(result).toMatchObject({ status: 'completed', checkpoint: 'promoted', fencingToken: 2 })
    expect(await repository.getCollection(collectionId)).toMatchObject({ currentPublishedVersion: 1, draftState: 'clean' })
    await expect(publishJobs.findById(job.id).lean()).resolves.toMatchObject({
      status: 'completed', leaseOwner: 'publish-worker-b', fencingToken: 2,
    })
    await expect(versions.findOne({ collectionId, version: 1 }).lean()).resolves.toMatchObject({ status: 'published' })
    await expect(audits.countDocuments({ eventKey: `collection.published:${job.id}` })).resolves.toBe(1)
  })

  test('count divergente na promocao: unavailable_count_changed e nenhum ponteiro se move', async () => {
    const { collectionId, job } = await publishTarget('cc-count-mismatch', 'cc-count-mismatch')
    const divergent = {
      introspectAdmin: async () => undefined,
      hydrateCurations: async () => ({ availableCount: 0, unavailableCount: 1 }),
    }
    // The count observed at run time no longer matches the confirmed count from
    // enqueue, so the job is terminal before the version is created. The engine
    // stores the terminal reason in the job `checkpoint`, not an errorCode
    // (publish-collection.ts terminal catch).
    const result = await runPublishJob(payload, job.id, 'publish-worker', divergent)
    expect(result).toMatchObject({ status: 'conflicted', checkpoint: 'unavailable_count_changed' })
    const released = await repository.getCollection(collectionId)
    // The pointer is absent before any promotion (stored field, not null).
    expect(released.currentPublishedVersion).toBeUndefined()
    expect(released).toMatchObject({ draftState: 'dirty', draftRevision: 1 })
    // The interval was applied before the availability recheck
    // (publish-collection.ts applyIntervals runs before inspectAvailability),
    // but the pointer never reached v1, so it is inert.
    await expect(memberships.findOne({ collectionId, curationId: 'c1' }).lean()).resolves.toMatchObject({ addedInVersion: 1 })
    await expect(versions.countDocuments({ collectionId })).resolves.toBe(0)
    await expect(audits.countDocuments({ eventKey: `collection.published:${job.id}` })).resolves.toBe(0)
  })

  test('versao com estado divergente nunca e promovida', async () => {
    const { collectionId, job } = await publishTarget('cc-version-diverged', 'cc-version-diverged')
    // Simulate another job having already published this version.
    await versions.create([{
      _id: new Types.ObjectId().toHexString(),
      collectionId, version: 1, metadataSnapshot: { slug: 'cc-version-diverged', title: 'cc-version-diverged' },
      selectedCount: 1, membershipHash: 'other-job-hash', publicationJobId: job.id,
      schemaVersion: 1, status: 'published', createdAt: new Date(), updatedAt: new Date(),
    }])
    // The promotion CAS requires exactly status 'ready'
    // (publish-collection.ts `version_not_ready`), so the pointer never moves.
    // The terminal reason is stored in the job `checkpoint` (not errorCode).
    const result = await runPublishJob(payload, job.id, 'publish-worker', availability)
    expect(result).toMatchObject({ status: 'conflicted', checkpoint: 'version_not_ready' })
    const notPromoted = await repository.getCollection(collectionId)
    // The pointer is absent before any promotion (stored field, not null).
    expect(notPromoted.currentPublishedVersion).toBeUndefined()
    await expect(versions.findOne({ collectionId, version: 1 }).lean()).resolves.toMatchObject({ status: 'published' })
    await expect(audits.countDocuments({ eventKey: `collection.published:${job.id}` })).resolves.toBe(0)
  })

  test('hash de versao ready pre-existente nao e revalidado antes da promocao', async () => {
    const { collectionId, job } = await publishTarget('cc-hash-not-revalidated', 'cc-hash-not-revalidated')
    // A crashed run may leave a 'ready' version behind. The engine reuses it
    // with $setOnInsert only (publish-collection.ts version upsert), so a
    // divergent hash on a pre-existing 'ready' version is NOT revalidated
    // before the promotion. This documents the engine's actual guarantee;
    // hash divergence can only arise from external tampering, since every job
    // computes its hash from the membership it just wrote.
    await versions.create([{
      _id: new Types.ObjectId().toHexString(),
      collectionId, version: 1, metadataSnapshot: { slug: 'cc-hash-not-revalidated', title: 'cc-hash-not-revalidated' },
      selectedCount: 1, membershipHash: 'tampered-hash', publicationJobId: job.id,
      schemaVersion: 1, status: 'ready', createdAt: new Date(), updatedAt: new Date(),
    }])
    const result = await runPublishJob(payload, job.id, 'publish-worker', availability)
    expect(result).toMatchObject({ status: 'completed', checkpoint: 'promoted' })
    await expect(versions.findOne({ collectionId, version: 1 }).lean()).resolves.toMatchObject({
      status: 'published', membershipHash: 'tampered-hash',
    })
  })

  test('crash apos o claim (locked) e retomado sem promover duas vezes', async () => {
    const { collectionId, job } = await publishTarget('cc-crash-locked', 'cc-crash-locked')
    const crashing = {
      hydrateCurations: availability.hydrateCurations,
      introspectAdmin: async () => { throw new AdminHttpError(503, 'authorization_unavailable') },
    }
    // Transient failure right after the claim: the job keeps its lease-free
    // 'running' state and the collection stays locked.
    await expect(runPublishJob(payload, job.id, 'publish-worker-a', crashing)).rejects.toMatchObject({
      status: 503, code: 'authorization_unavailable',
    })
    await expect(publishJobs.findById(job.id).lean()).resolves.toMatchObject({ status: 'running', checkpoint: 'locked' })
    expect((await loadCollection(collectionId))?.draftState).toBe('publishing')
    await expect(memberships.countDocuments({ collectionId })).resolves.toBe(0)

    const result = await runPublishJob(payload, job.id, 'publish-worker-b', availability)
    expect(result).toMatchObject({ status: 'completed', checkpoint: 'promoted' })
    expect(await repository.getCollection(collectionId)).toMatchObject({ currentPublishedVersion: 1, draftState: 'clean' })
    await expect(memberships.countDocuments({ collectionId, curationId: 'c1', removedInVersion: null })).resolves.toBe(1)
    await expect(audits.countDocuments({ eventKey: `collection.published:${job.id}` })).resolves.toBe(1)
  })

  test('crash apos intervals_applied e retomado sem duplicar intervals', async () => {
    const { collectionId, job } = await publishTarget('cc-crash-intervals', 'cc-crash-intervals')
    let hydrations = 0
    const crashing = {
      introspectAdmin: async () => undefined,
      hydrateCurations: async (ids: string[]) => {
        hydrations += 1
        if (hydrations === 1) throw new AdminHttpError(503, 'authorization_unavailable')
        return { availableCount: ids.length, unavailableCount: 0 }
      },
    }
    await expect(runPublishJob(payload, job.id, 'publish-worker-a', crashing)).rejects.toMatchObject({
      status: 503, code: 'authorization_unavailable',
    })
    // The interval for c1 was already applied before the availability check
    // crashed; the retry must not open a second interval.
    await expect(memberships.countDocuments({ collectionId, curationId: 'c1' })).resolves.toBe(1)
    await expect(publishJobs.findById(job.id).lean()).resolves.toMatchObject({ status: 'running', checkpoint: 'intervals_applied' })

    const result = await runPublishJob(payload, job.id, 'publish-worker-b', availability)
    expect(result).toMatchObject({ status: 'completed', checkpoint: 'promoted' })
    await expect(memberships.countDocuments({ collectionId, curationId: 'c1' })).resolves.toBe(1)
    await expect(audits.countDocuments({ eventKey: `collection.published:${job.id}` })).resolves.toBe(1)
  })

  test('crash apos a versao pronta (validated) e retomado via takeover sem duplicar', async () => {
    const { collectionId, job } = await publishTarget('cc-crash-validated', 'cc-crash-validated')
    // A worker that died between marking the version 'ready' and the promotion
    // transaction leaves: job 'committing' with an expired lease and the
    // version 'ready' (as its run wrote it).
    await publishJobs.updateOne({ _id: job.id }, {
      $set: { status: 'committing', checkpoint: 'validated', leaseOwner: 'dead-worker', leaseExpiresAt: new Date(Date.now() - 1_000), fencingToken: 3 },
    })
    await versions.create([{
      _id: new Types.ObjectId().toHexString(),
      collectionId, version: 1, metadataSnapshot: { slug: 'cc-crash-validated', title: 'cc-crash-validated' },
      selectedCount: 1, membershipHash: 'crashed-run-hash', publicationJobId: job.id,
      schemaVersion: 1, status: 'ready', createdAt: new Date(), updatedAt: new Date(),
    }])

    const result = await runPublishJob(payload, job.id, 'publish-worker-b', availability)
    expect(result).toMatchObject({ status: 'completed', checkpoint: 'promoted', fencingToken: 4 })
    expect(await repository.getCollection(collectionId)).toMatchObject({ currentPublishedVersion: 1, draftState: 'clean' })
    await expect(versions.findOne({ collectionId, version: 1 }).lean()).resolves.toMatchObject({ status: 'published' })
    await expect(audits.countDocuments({ eventKey: `collection.published:${job.id}` })).resolves.toBe(1)
  })

  test('rerun apos a promocao (promoted) nao promove duas vezes', async () => {
    const { collectionId, job } = await publishTarget('cc-crash-promoted', 'cc-crash-promoted')
    const first = await runPublishJob(payload, job.id, 'publish-worker-a', availability)
    expect(first).toMatchObject({ status: 'completed', checkpoint: 'promoted' })

    const again = await runPublishJob(payload, job.id, 'publish-worker-b', availability)
    expect(again).toBeNull()
    expect(await repository.getCollection(collectionId)).toMatchObject({ currentPublishedVersion: 1, draftState: 'clean' })
    await expect(audits.countDocuments({ eventKey: `collection.published:${job.id}` })).resolves.toBe(1)
  })

  test('falha antes da transacao mantem current e draft (runPublishWithCrash)', async () => {
    const { seedPublishedWithDirtyDraft, runPublishWithCrash, loadCollection } = await import('../support/collection-fixtures')
    const collection = await seedPublishedWithDirtyDraft()
    await expect(runPublishWithCrash(collection.id, 'before_promote')).rejects.toMatchObject({
      status: 403, code: 'authorization_revoked',
    })
    // The published pointer and the dirty draft are untouched.
    const reloaded = await loadCollection(database, collection.id)
    expect(reloaded).toMatchObject({ currentPublishedVersion: 1, draftState: 'dirty' })
    // The crashed run left version 2 'ready' but never published it: only the
    // fixture's own version-1 publish audit exists for this collection.
    await expect(versions.findOne({ collectionId: collection.id, version: 2 }).lean()).resolves.toMatchObject({ status: 'ready' })
    await expect(audits.countDocuments({ collectionId: collection.id, eventType: 'collection.published' })).resolves.toBe(1)
  })

  async function loadCollection(collectionId: string) {
    const { loadCollection: load } = await import('../support/collection-fixtures')
    return load(database, collectionId)
  }
})
