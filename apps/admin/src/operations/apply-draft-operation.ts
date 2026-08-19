import type { ClientSession, Model } from 'mongoose'
import type { Payload } from 'payload'
import { appendAuditEvent } from '../audit/append-event'
import { convergeDraftDelta } from '../collections/draft-delta'
import { AdminHttpError } from '../http/errors'
import { FastApiCatalogClient } from './catalog-client'
import type { CatalogResolver, DraftOperationRecord, OperationLease } from './types'

type DocumentModel = Model<Record<string, unknown>>
const TERMINAL = ['committed', 'completed', 'completed_with_skips', 'failed', 'cancelled', 'stale', 'conflicted', 'authorization_revoked']
const CLAIMABLE = ['queued', 'materializing', 'staging', 'validating', 'committing']
// `committing` is deliberately reclaimable after its lease expires, but it is
// never cancellable: the collection pointer and staged rows are about to move
// together in one transaction.
const CANCELLABLE = ['queued', 'materializing', 'staging', 'validating']
const LEASE_MS = 60_000

export interface ApplyDraftOperationHooks {
  /** Test/observability checkpoint immediately before the committing CAS. */
  beforeCommitting?: () => Promise<void>
}

class TerminalOperationError extends Error {
  constructor(
    readonly status: 'stale' | 'conflicted' | 'authorization_revoked',
    readonly errorCode: string,
  ) {
    super(errorCode)
  }
}

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function asOperation(document: unknown): DraftOperationRecord {
  const value = document as Record<string, unknown>
  return { ...value, id: String(value.id ?? value._id) } as DraftOperationRecord
}

function ownedFence(operation: DraftOperationRecord, lease: OperationLease) {
  return {
    _id: operation.id,
    leaseOwner: lease.owner,
    fencingToken: lease.fencingToken,
    leaseExpiresAt: { $gt: new Date() },
  }
}

async function assertFence(
  operations: DocumentModel,
  operation: DraftOperationRecord,
  lease: OperationLease,
  session?: ClientSession,
  status?: string | string[],
): Promise<void> {
  const filter: Record<string, unknown> = ownedFence(operation, lease)
  if (status) filter.status = Array.isArray(status) ? { $in: status } : status
  const fresh = await operations.findOne(filter).session(session ?? null).lean()
  if (!fresh) throw new AdminHttpError(409, 'conflict')
}

async function claim(payload: Payload, operationId: string, owner: string): Promise<{ operation: DraftOperationRecord; lease: OperationLease } | null> {
  const operations = modelFor(payload, 'collection-operations')
  const requested = await operations.findById(operationId).lean()
  if (!requested) throw new AdminHttpError(404, 'not_found')
  const operation = asOperation(requested)
  if (TERMINAL.includes(operation.status)) return null
  const earlier = await operations.findOne({
    collectionId: operation.collectionId,
    operationSequence: { $lt: operation.operationSequence },
    status: { $nin: TERMINAL },
  }).lean()
  if (earlier) return null
  const now = new Date()
  const claimed = await operations.findOneAndUpdate(
    { _id: operationId, status: { $in: CLAIMABLE }, $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lt: now } }, { leaseOwner: owner }] },
    { $set: { status: 'materializing', checkpoint: 'materializing', leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: now }, $inc: { fencingToken: 1 } },
    { new: true, lean: true },
  )
  if (!claimed) return null
  const claimedOperation = asOperation(claimed)
  return { operation: claimedOperation, lease: { owner, fencingToken: claimedOperation.fencingToken } }
}

async function inTransaction<T>(payload: Payload, work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await payload.db.connection.startSession()
  try {
    let result: T | undefined
    await session.withTransaction(async () => { result = await work(session) })
    return result as T
  } finally {
    await session.endSession()
  }
}

/** Applies staging that becomes observable only after the collection revision CAS. */
export async function applyDraftOperation(
  payload: Payload,
  operationId: string,
  owner: string,
  resolver: CatalogResolver = new FastApiCatalogClient(),
  hooks: ApplyDraftOperationHooks = {},
): Promise<DraftOperationRecord | null> {
  const claimed = await claim(payload, operationId, owner)
  if (!claimed) return null
  const { operation, lease } = claimed
  const operations = modelFor(payload, 'collection-operations')
  const collections = modelFor(payload, 'collections')
  const items = modelFor(payload, 'collection-operation-items')
  const changes = modelFor(payload, 'collection-draft-changes')
  const memberships = modelFor(payload, 'collection-memberships')
  const audit = modelFor(payload, 'audit-events')

  try {
    await resolver.introspectAdmin(operation.actorId)
    await assertFence(operations, operation, lease)
    const lifecycleAtClaim = await collections.findById(operation.collectionId).lean() as Record<string, unknown> | null
    if (lifecycleAtClaim?.lifecycle === 'archived') {
      throw new TerminalOperationError('stale', 'collection_archived')
    }
    const candidateItems = await items.find({ operationId, status: { $in: ['pending', 'applied'] } }).lean()
    const resolved = await resolver.resolveCurations(candidateItems.map((item) => String(item.curationId)), operation.actorId)
    const rejected = new Map(resolved.rejected.map((item) => [item.curationId, item.reason]))
    for (const item of candidateItems) {
      const reason = rejected.get(String(item.curationId))
      if (reason) {
        await items.updateOne({ _id: item._id, status: { $in: ['pending', 'applied'] } }, { $set: { status: 'skipped', reasonCode: reason } })
        await changes.deleteOne({ operationId, curationId: String(item.curationId) })
      }
    }
    const eligible = resolved.eligibleIds
    if (eligible.length === 0) {
      const completed = await operations.updateOne(
        { ...ownedFence(operation, lease), status: { $in: CANCELLABLE } },
        { $set: { status: 'completed_with_skips', checkpoint: 'no_eligible_items', leaseExpiresAt: null, updatedAt: new Date() } },
      )
      if (completed.modifiedCount !== 1) throw new AdminHttpError(409, 'conflict')
      return asOperation(await operations.findById(operationId).lean())
    }

    const collection = await collections.findById(operation.collectionId).lean() as Record<string, unknown> | null
    if (collection?.lifecycle === 'archived') {
      throw new TerminalOperationError('stale', 'collection_archived')
    }
    if (!collection || collection.draftState === 'publishing' || collection.draftRevision !== operation.baseDraftRevision) {
      throw new TerminalOperationError('conflicted', 'draft_revision_changed')
    }
    const targetDraftRevision = Number(collection.draftRevision) + 1
    const staging = await operations.updateOne(
      { ...ownedFence(operation, lease), status: { $in: CANCELLABLE } },
      { $set: { status: 'staging', checkpoint: 'staging', targetDraftRevision, updatedAt: new Date() } },
    )
    if (staging.modifiedCount !== 1) throw new AdminHttpError(409, 'conflict')
    for (const curationId of eligible) {
      const membership = await memberships.findOne({ collectionId: operation.collectionId, curationId, removedInVersion: null }).lean()
      const existing = await changes.findOne({
        collectionId: operation.collectionId,
        curationId,
        draftEpoch: collection.draftEpoch,
        stageState: 'committed',
        $or: [{ validUntilDraftRevision: null }, { validUntilDraftRevision: { $gte: Number(collection.draftRevision) } }],
      }).sort({ targetDraftRevision: -1 }).lean()
      const desired = convergeDraftDelta(Boolean(membership), (existing?.desiredState as 'add' | 'remove' | undefined) ?? null, operation.action)
      if (desired) {
        await changes.updateOne(
          { operationId, curationId, stageState: 'staged' },
          { $set: {
            collectionId: operation.collectionId, curationId, desiredState: desired, basePublishedVersion: collection.currentPublishedVersion ?? null,
            draftEpoch: collection.draftEpoch, baseDraftRevision: Number(collection.draftRevision), targetDraftRevision, operationId,
            operationSequence: operation.operationSequence, stageState: 'staged', validUntilDraftRevision: null, updatedAt: new Date(),
          }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        )
      } else {
        await changes.deleteOne({ operationId, curationId, stageState: 'staged' })
      }
      await items.updateOne({ operationId, curationId, status: 'pending' }, { $set: { status: 'applied', targetDraftRevision } })
    }
    await resolver.introspectAdmin(operation.actorId)
    await assertFence(operations, operation, lease)
    await hooks.beforeCommitting?.()
    const enteringCommit = await operations.updateOne(
      { ...ownedFence(operation, lease), status: { $in: CANCELLABLE } },
      { $set: { status: 'committing', checkpoint: 'before_commit', updatedAt: new Date() } },
    )
    if (enteringCommit.modifiedCount !== 1) throw new AdminHttpError(409, 'conflict')
    await inTransaction(payload, async (session) => {
      await assertFence(operations, operation, lease, session, 'committing')
      const current = await collections.findOne({
        _id: operation.collectionId,
        draftRevision: collection.draftRevision,
        draftEpoch: collection.draftEpoch,
        draftState: { $ne: 'publishing' },
        lifecycle: { $ne: 'archived' },
      }).session(session).lean()
      if (!current) throw new TerminalOperationError('conflicted', 'draft_revision_changed')
      const advanced = await collections.updateOne(
        {
          _id: operation.collectionId,
          draftRevision: collection.draftRevision,
          draftEpoch: collection.draftEpoch,
          draftState: { $ne: 'publishing' },
          lifecycle: { $ne: 'archived' },
        },
        { $set: { draftState: 'dirty', updatedAt: new Date() }, $inc: { draftRevision: 1 } },
        { session },
      )
      if (advanced.modifiedCount !== 1) throw new TerminalOperationError('conflicted', 'draft_revision_changed')
      const applied = await items.find({ operationId, status: 'applied' }).session(session).lean()
      const curationIds = applied.map((item) => String(item.curationId))
      if (curationIds.length) {
        await changes.updateMany(
          {
            collectionId: operation.collectionId,
            curationId: { $in: curationIds },
            draftEpoch: collection.draftEpoch,
            stageState: 'committed',
            $or: [{ validUntilDraftRevision: null }, { validUntilDraftRevision: { $gte: Number(collection.draftRevision) } }],
          },
          { $set: { validUntilDraftRevision: Number(collection.draftRevision), updatedAt: new Date() } },
          { session },
        )
      }
      await changes.updateMany(
        { operationId, stageState: 'staged', draftEpoch: collection.draftEpoch },
        { $set: { stageState: 'committed', updatedAt: new Date() } },
        { session },
      )
      const committed = await operations.updateOne(
        { _id: operationId, status: 'committing', leaseOwner: owner, fencingToken: lease.fencingToken },
        { $set: { status: 'committed', checkpoint: 'committed', leaseExpiresAt: null, updatedAt: new Date() } }, { session },
      )
      if (committed.modifiedCount !== 1) throw new AdminHttpError(409, 'conflict')
      await appendAuditEvent(audit, {
        actorId: operation.actorId, afterRevision: Number(collection.revision), beforeRevision: Number(collection.revision),
        collectionId: operation.collectionId, eventKey: `collection.operation_committed:${operationId}`,
        eventType: 'collection.draft_operation_committed', metadata: { targetDraftRevision }, operationId, requestId: operation.requestId,
      }, session)
    })
  } catch (error) {
    const terminal = error instanceof TerminalOperationError
      ? error
      : error instanceof AdminHttpError && error.status === 403
        ? new TerminalOperationError('authorization_revoked', 'authorization_revoked')
        : null
    if (terminal) {
      const terminalized = await operations.updateOne(
        { ...ownedFence(operation, lease), status: { $nin: TERMINAL } },
        { $set: { status: terminal.status, errorCode: terminal.errorCode, leaseExpiresAt: null, updatedAt: new Date() } },
      )
      // Staged rows are intentionally invisible, but must not accumulate after
      // a terminal command.  Only the worker that successfully terminalized
      // its own fenced operation may remove them.
      if (terminalized.modifiedCount === 1) {
        await changes.deleteMany({ operationId, stageState: 'staged' })
      }
    } else {
      // Availability and storage failures are retryable. Release this lease
      // without making the command terminal, then rethrow so Payload applies
      // its task retry/backoff policy instead of acknowledging the job.
      await operations.updateOne(
        { ...ownedFence(operation, lease), status: { $nin: TERMINAL } },
        { $set: { checkpoint: 'retryable', leaseExpiresAt: new Date(), updatedAt: new Date() } },
      )
    }
    const current = await operations.findById(operationId).lean()
    if (current && TERMINAL.includes(String((current as Record<string, unknown>).status))) return asOperation(current)
    // A worker that lost its fence must never acknowledge a command merely
    // because the error was otherwise terminal for the original lease.
    throw error
  }
  const finished = await operations.findById(operationId).lean()
  return finished ? asOperation(finished) : null
}

export async function cancelDraftOperation(payload: Payload, operationId: string): Promise<DraftOperationRecord> {
  const operations = modelFor(payload, 'collection-operations')
  const changes = modelFor(payload, 'collection-draft-changes')
  const cancelled = await operations.findOneAndUpdate(
    { _id: operationId, status: { $in: CANCELLABLE } },
    { $set: { status: 'cancelled', checkpoint: 'cancelled', leaseExpiresAt: null, updatedAt: new Date() }, $inc: { fencingToken: 1 } },
    { new: true, lean: true },
  )
  if (!cancelled) throw new AdminHttpError(409, 'conflict')
  await changes.deleteMany({ operationId, stageState: 'staged' })
  return asOperation(cancelled)
}
