import { ObjectId, type Db } from 'mongodb'
import type { Model } from 'mongoose'
import type { Payload } from 'payload'
import { afterAll, afterEach } from 'vitest'

function objectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new Error(`Invalid ObjectId: ${id}`)
  return new ObjectId(id)
}

/** Reads only the committed, revision-bounded delta projection used by draft views. */
export async function visibleDraftChanges(db: Db, collectionId: string) {
  const collection = await db.collection('collections').findOne({ _id: objectId(collectionId) })
  if (!collection) throw new Error(`Collection not found: ${collectionId}`)
  const committed = await db.collection('collection_operations').find({
    collectionId,
    status: 'committed',
  }, { projection: { _id: 1 } }).toArray()
  return db.collection('collection_draft_changes').aggregate([
    {
      $match: {
        collectionId,
        draftEpoch: collection.draftEpoch,
        stageState: 'committed',
        targetDraftRevision: { $lte: collection.draftRevision },
        $or: [
          { validUntilDraftRevision: null },
          { validUntilDraftRevision: { $gte: collection.draftRevision } },
        ],
        operationId: { $in: committed.map((operation) => String(operation._id)) },
      },
    },
    { $sort: { curationId: 1, targetDraftRevision: -1, operationSequence: -1 } },
    { $group: { _id: '$curationId', change: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$change' } },
    { $sort: { curationId: 1 } },
  ]).toArray()
}

export async function loadOperation(db: Db, operationId: string) {
  return db.collection('collection_operations').findOne({ _id: objectId(operationId) })
}

export async function loadCollection(db: Db, collectionId: string) {
  return db.collection('collections').findOne({ _id: objectId(collectionId) })
}

// ---------------------------------------------------------------------------
// Shared Payload instance
//
// The concurrency suites seed through fixture helpers whose signatures take no
// Payload (see the plan's exports), so this module owns ONE lazy Payload per
// test file. Test files call getSharedPayload() instead of building their own;
// the connection is closed by this module's afterAll. Files that never call it
// (e.g. the original draft-operation suite) leave it uninitialized.
// ---------------------------------------------------------------------------

let sharedPayload: Promise<Payload> | undefined

export function getSharedPayload(): Promise<Payload> {
  if (!sharedPayload) {
    sharedPayload = (async () => {
      const [{ getPayload }, { default: config }] = await Promise.all([
        import('payload'),
        import('../../../payload.config'),
      ])
      return getPayload({ config })
    })()
  }
  return sharedPayload
}

// In-memory dependencies for every fixture helper: the worker flow never talks
// to the real FastAPI in integration tests.
const fixtureCatalog = {
  introspectAdmin: async () => undefined,
  resolveCurations: async (ids: string[]) => ({ eligibleIds: ids, rejected: [] }),
}
const fixtureAvailability = {
  introspectAdmin: async () => undefined,
  hydrateCurations: async (ids: string[]) => ({ availableCount: ids.length, unavailableCount: 0 }),
}

// Registry of fixture-created root documents; teardown is ID-scoped only.
const created: Array<{ model: string; id: string }> = []
let fixtureSequence = 0

function track(model: string, id: string): string {
  created.push({ model, id })
  return id
}

function nextKey(prefix: string): string {
  fixtureSequence += 1
  return `${prefix}-${fixtureSequence}`
}

async function modelFor(payload: Payload, slug: string): Promise<Model<Record<string, unknown>>> {
  const model = payload.db.collections[slug] as unknown as Model<Record<string, unknown>> | undefined
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model
}

async function createFixtureCollection(slug: string) {
  const payload = await getSharedPayload()
  const { createCollectionRepository } = await import('../../../src/collections/repository')
  const repository = createCollectionRepository(payload)
  const key = nextKey('fixture-create')
  const collection = await repository.createCollection(
    { slug, title: `Fixture ${slug}` },
    { actorId: 'admin-1', idempotencyKey: key, requestId: `fixture-${slug}-create` },
  )
  track('collections', collection.id)
  return { payload, repository, collection }
}

export interface SeedOperationOptions {
  curationIds: string[]
  action?: 'add' | 'remove'
  baseDraftRevision?: number
}

/**
 * Creates a fresh collection and enqueues one explicit draft operation for the
 * given curation ids. Returns the queued operation record; the worker must run
 * it (directly or through runUntilCheckpoint).
 */
export async function seedOperation({ curationIds, action = 'add', baseDraftRevision = 0 }: SeedOperationOptions) {
  const { payload, collection } = await createFixtureCollection(nextKey('seed-operation'))
  const { enqueueDraftOperation } = await import('../../../src/operations/enqueue')
  const key = nextKey('fixture-op')
  const operation = await enqueueDraftOperation(payload, {
    collectionId: collection.id,
    action,
    baseDraftRevision,
    curationIds,
    idempotencyKey: key,
    actorId: 'admin-1',
    requestId: `${key}-request`,
  }, { resolve: fixtureCatalog })
  track('collection-operations', operation.id)
  track('payload-jobs', operation.jobId)
  return operation
}

/**
 * Applies the operation and simulates a crash at the requested checkpoint:
 *
 * - 'materializing': the catalog resolve fails transiently right after the
 *   claim, so the operation stays claimable with checkpoint 'retryable'.
 * - 'staging' | 'before_commit' | 'committing': a crash between staging and
 *   the committing CAS (the only engine hook, apply-draft-operation.ts
 *   `beforeCommitting`), which raises `simulated_crash` and leaves the
 *   operation claimable with checkpoint 'retryable'.
 *
 * In both cases the visible draft does not advance and the operation can be
 * retried to completion. Rejects with the crash error.
 */
export async function runUntilCheckpoint(
  operationId: string,
  checkpoint: 'materializing' | 'staging' | 'before_commit' | 'committing',
): Promise<never> {
  const payload = await getSharedPayload()
  const { applyDraftOperation } = await import('../../../src/operations/apply-draft-operation')
  if (checkpoint === 'materializing') {
    const { AdminHttpError } = await import('../../../src/http/errors')
    const crashingCatalog = {
      introspectAdmin: async () => undefined,
      resolveCurations: async () => { throw new AdminHttpError(503, 'authorization_unavailable') },
    }
    await applyDraftOperation(payload, operationId, 'fixture-worker', crashingCatalog)
  } else {
    await applyDraftOperation(payload, operationId, 'fixture-worker', fixtureCatalog, {
      beforeCommitting: async () => { throw new Error('simulated_crash') },
    })
  }
  throw new Error(`runUntilCheckpoint did not crash at ${checkpoint}`)
}

/**
 * Creates a collection, publishes version 1 with `publishedIds`, then dirties
 * the draft with `dirtyIds` so an explicit publish can be exercised. Returns
 * the collection record (id, revision, draftRevision, draftState, ...).
 */
export async function seedPublishedWithDirtyDraft(options: { publishedIds?: string[]; dirtyIds?: string[] } = {}) {
  const { publishedIds = ['c1'], dirtyIds = ['c2'] } = options
  const { payload, repository, collection } = await createFixtureCollection(nextKey('seed-published'))
  const { enqueueDraftOperation } = await import('../../../src/operations/enqueue')
  const { applyDraftOperation } = await import('../../../src/operations/apply-draft-operation')
  const { enqueuePublish, runPublishJob } = await import('../../../src/publishing/publish-collection')

  const first = await enqueueDraftOperation(payload, {
    collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: publishedIds,
    idempotencyKey: nextKey('fixture-publish-add'), actorId: 'admin-1', requestId: 'fixture-publish-add-request',
  }, { resolve: fixtureCatalog })
  track('collection-operations', first.id)
  track('payload-jobs', first.jobId)
  await applyDraftOperation(payload, first.id, 'fixture-worker', fixtureCatalog)

  const clean = await repository.getCollection(collection.id)
  const publish = await enqueuePublish(payload, {
    collectionId: collection.id, ifMatch: clean.revision,
    idempotencyKey: nextKey('fixture-publish-pub'), requestId: 'fixture-publish-pub-request',
    actorId: 'admin-1', confirmUnavailable: false,
  }, fixtureAvailability)
  track('collection-publish-jobs', publish.id)
  track('payload-jobs', publish.payloadJobId)
  await runPublishJob(payload, publish.id, 'fixture-publish-worker', fixtureAvailability)

  const dirty = await enqueueDraftOperation(payload, {
    collectionId: collection.id, action: 'add', baseDraftRevision: 0, curationIds: dirtyIds,
    idempotencyKey: nextKey('fixture-publish-dirty'), actorId: 'admin-1', requestId: 'fixture-publish-dirty-request',
  }, { resolve: fixtureCatalog })
  track('collection-operations', dirty.id)
  track('payload-jobs', dirty.jobId)
  await applyDraftOperation(payload, dirty.id, 'fixture-worker', fixtureCatalog)

  return repository.getCollection(collection.id)
}

/**
 * Enqueues an explicit publish for the collection and crashes it right before
 * the promotion transaction (publish-collection.ts second introspectAdmin,
 * after the version was marked 'ready'). The job ends terminal
 * `authorization_revoked`, the collection draft is released back to 'dirty'
 * and the published pointer never moves. Rejects with the revocation error so
 * callers can assert the crash.
 */
export async function runPublishWithCrash(collectionId: string, checkpoint: 'before_promote'): Promise<never> {
  const payload = await getSharedPayload()
  const db = payload.db.connection.db
  if (!db) throw new Error('Mongo database unavailable')
  const collection = await loadCollection(db, collectionId)
  if (!collection) throw new Error(`Collection not found: ${collectionId}`)
  const { enqueuePublish, runPublishJob } = await import('../../../src/publishing/publish-collection')
  const { AdminHttpError } = await import('../../../src/http/errors')

  const job = await enqueuePublish(payload, {
    collectionId, ifMatch: Number(collection.revision),
    idempotencyKey: nextKey('fixture-publish-crash'), requestId: 'fixture-publish-crash-request',
    actorId: 'admin-1', confirmUnavailable: false,
  }, fixtureAvailability)
  track('collection-publish-jobs', job.id)
  track('payload-jobs', job.payloadJobId)

  let introspections = 0
  const revoking = {
    ...fixtureAvailability,
    introspectAdmin: async () => {
      introspections += 1
      if (introspections === 2) throw new AdminHttpError(403, 'authorization_revoked')
    },
  }
  const result = await runPublishJob(payload, job.id, 'fixture-publish-worker', revoking)
  if (!result || result.status !== 'authorization_revoked') {
    throw new Error(`runPublishWithCrash did not crash at ${checkpoint} (status=${result?.status})`)
  }
  throw new AdminHttpError(403, 'authorization_revoked')
}

// ID-scoped teardown of every document the fixtures created. The worker suites
// also wipe all CMS collections in their own afterEach; this registry keeps the
// support module safe even if a suite stops doing that.
afterEach(async () => {
  if (!created.length) return
  const payload = await getSharedPayload()
  for (const { model, id } of created.splice(0)) {
    await modelFor(payload, model).then((m) => m.deleteOne({ _id: id }).catch(() => undefined))
  }
})

afterAll(async () => {
  if (!sharedPayload) return
  const payload = await sharedPayload
  await payload.db.connection.close()
})
