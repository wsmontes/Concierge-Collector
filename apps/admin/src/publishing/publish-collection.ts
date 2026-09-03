import { createHash, randomUUID } from 'node:crypto'
import { Types, type ClientSession, type Model } from 'mongoose'
import type { Payload } from 'payload'
import { appendAuditEvent } from '../audit/append-event'
import { computeCanonicalMembershipHash } from '../collections/canonical-membership-hash'
import { AdminHttpError } from '../http/errors'
import { applyDraftOperation } from '../operations/apply-draft-operation'
import { enqueueDraftOperation } from '../operations/enqueue'
import { FastApiCatalogClient } from '../operations/catalog-client'
import type { CatalogResolver } from '../operations/types'
import { FastApiPublishAvailabilityClient } from './availability-client'
import { diffMembershipAtVersions, inspectAvailability, streamDraftMembershipIds, streamMembershipAtVersion } from './membership-stream'
import { resetTargetVersionStaging } from './publish-staging'
import type { EnqueuePublishCommand, PublishAvailabilityClient, PublishJobRecord, PublishLease, RestoreVersionAsDraftCommand, RestoreVersionAsDraftResult } from './types'

type DocumentModel = Model<Record<string, unknown>>
// Superset of terminal publish and draft-operation states: publish enqueue
// must not let a completed-with-skips operation hold the draft hostage.
const TERMINAL = ['completed', 'completed_with_skips', 'committed', 'failed', 'cancelled', 'stale', 'conflicted', 'authorization_revoked']
const CLAIMABLE = ['queued', 'running', 'committing']
const LEASE_MS = 60_000

class TerminalPublishError extends Error {
  constructor(readonly status: 'stale' | 'conflicted' | 'authorization_revoked', readonly code: string) {
    super(code)
  }
}

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function record(document: unknown): PublishJobRecord {
  const value = document as Record<string, unknown>
  return { ...value, id: String(value.id ?? value._id) } as PublishJobRecord
}

function assertObjectId(value: string): void {
  if (!/^[a-f\d]{24}$/i.test(value)) throw new AdminHttpError(404, 'not_found')
}

function requestHash(command: EnqueuePublishCommand): string {
  return createHash('sha256').update(JSON.stringify({
    actorId: command.actorId,
    collectionId: command.collectionId,
    ifMatch: command.ifMatch,
    confirmUnavailable: command.confirmUnavailable,
    expectedUnavailableCount: command.expectedUnavailableCount ?? null,
  })).digest('hex')
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

function metadataSnapshot(collection: Record<string, unknown>): Record<string, unknown> {
  return { slug: collection.slug, title: collection.title, description: collection.description ?? null }
}

async function preflightAvailability(
  payload: Payload,
  collection: Record<string, unknown>,
  client: PublishAvailabilityClient,
) {
  return inspectAvailability(streamDraftMembershipIds({
    memberships: modelFor(payload, 'collection-memberships'),
    changes: modelFor(payload, 'collection-draft-changes'),
    collectionId: String(collection._id),
    baseVersion: typeof collection.currentPublishedVersion === 'number' ? collection.currentPublishedVersion : null,
    draftEpoch: String(collection.draftEpoch),
    draftRevision: Number(collection.draftRevision),
  }), (ids) => client.hydrateCurations(ids))
}

export async function enqueuePublish(
  payload: Payload,
  command: EnqueuePublishCommand,
  client: PublishAvailabilityClient = new FastApiPublishAvailabilityClient(),
): Promise<PublishJobRecord> {
  assertObjectId(command.collectionId)
  if (!Number.isInteger(command.ifMatch) || command.ifMatch < 1) throw new AdminHttpError(412, 'precondition_failed')
  const collections = modelFor(payload, 'collections')
  const publishJobs = modelFor(payload, 'collection-publish-jobs')
  const operations = modelFor(payload, 'collection-operations')
  const audit = modelFor(payload, 'audit-events')
  const hash = requestHash(command)
  const existing = await publishJobs.findOne({ collectionId: command.collectionId, idempotencyKey: command.idempotencyKey }).lean()
  if (existing) {
    if ((existing as Record<string, unknown>).requestHash !== hash) throw new AdminHttpError(409, 'idempotency_conflict')
    return record(existing)
  }
  const collection = await collections.findById(command.collectionId).lean() as Record<string, unknown> | null
  if (!collection) throw new AdminHttpError(404, 'not_found')
  if (collection.lifecycle === 'archived') throw new AdminHttpError(409, 'conflict')
  if (collection.draftState === 'publishing') throw new AdminHttpError(423, 'draft_locked')
  if (Number(collection.revision) !== command.ifMatch) throw new AdminHttpError(412, 'revision_conflict')
  if (await operations.findOne({ collectionId: command.collectionId, status: { $nin: TERMINAL } }).lean()) {
    throw new AdminHttpError(409, 'conflict')
  }

  await client.introspectAdmin(command.actorId)
  const availability = await preflightAvailability(payload, collection, client)
  if (availability.unavailableCount > 0 && (!command.confirmUnavailable || command.expectedUnavailableCount !== availability.unavailableCount)) {
    throw new AdminHttpError(409, 'unavailable_confirmation_required')
  }

  const now = new Date()
  const jobId = new Types.ObjectId().toHexString()
  const payloadJobId = new Types.ObjectId().toHexString()
  try {
    return await inTransaction(payload, async (session) => {
      const nonterminal = await operations.findOne({ collectionId: command.collectionId, status: { $nin: TERMINAL } }).session(session).lean()
      if (nonterminal) throw new AdminHttpError(409, 'conflict')
      const locked = await collections.findOneAndUpdate(
        { _id: command.collectionId, revision: command.ifMatch, lifecycle: { $ne: 'archived' }, draftState: { $ne: 'publishing' } },
        { $set: { draftState: 'publishing', updatedAt: now }, $inc: { revision: 1 } },
        { new: true, lean: true, session },
      ) as Record<string, unknown> | null
      if (!locked) throw new AdminHttpError(412, 'revision_conflict')
      const job = {
        _id: jobId, collectionId: command.collectionId,
        fixedCollectionRevision: Number(locked.revision), fixedDraftEpoch: String(locked.draftEpoch),
        fixedDraftRevision: Number(locked.draftRevision), baseVersion: typeof locked.currentPublishedVersion === 'number' ? locked.currentPublishedVersion : null,
        targetVersion: (typeof locked.currentPublishedVersion === 'number' ? locked.currentPublishedVersion : 0) + 1,
        status: 'queued', selectedCount: availability.selectedCount, fencingToken: 0,
        actorId: command.actorId, requestId: command.requestId, idempotencyKey: command.idempotencyKey,
        requestHash: hash, payloadJobId, confirmedUnavailableCount: availability.unavailableCount,
        createdAt: now, updatedAt: now,
      }
      await publishJobs.create([job], { session })
      await modelFor(payload, 'payload-jobs').create([{
        _id: payloadJobId, input: { publishJobId: jobId }, taskSlug: 'publish-collection', queue: 'collection-publications',
        processing: false, totalTried: 0, hasError: false, createdAt: now, updatedAt: now,
      }], { session })
      await appendAuditEvent(audit, {
        actorId: command.actorId, beforeRevision: command.ifMatch, afterRevision: Number(locked.revision), collectionId: command.collectionId,
        eventKey: `collection.publish_enqueued:${jobId}`, eventType: 'collection.publish_enqueued',
        metadata: { fixedDraftRevision: job.fixedDraftRevision, unavailableCount: availability.unavailableCount },
        publicationJobId: jobId, requestId: command.requestId,
      }, session)
      return record(job)
    })
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000) {
      const retry = await publishJobs.findOne({ collectionId: command.collectionId, idempotencyKey: command.idempotencyKey }).lean()
      if (retry && (retry as Record<string, unknown>).requestHash === hash) return record(retry)
      throw new AdminHttpError(409, 'idempotency_conflict')
    }
    throw error
  }
}

function ownedFence(job: PublishJobRecord, lease: PublishLease) {
  return { _id: job.id, leaseOwner: lease.owner, fencingToken: lease.fencingToken, leaseExpiresAt: { $gt: new Date() } }
}

async function claim(payload: Payload, jobId: string, owner: string): Promise<{ job: PublishJobRecord; lease: PublishLease } | null> {
  const jobs = modelFor(payload, 'collection-publish-jobs')
  const existing = await jobs.findById(jobId).lean()
  if (!existing) throw new AdminHttpError(404, 'not_found')
  if (TERMINAL.includes(String((existing as Record<string, unknown>).status))) return null
  const now = new Date()
  const claimed = await jobs.findOneAndUpdate(
    { _id: jobId, status: { $in: CLAIMABLE }, $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lt: now } }, { leaseOwner: owner }] },
    { $set: { status: 'running', checkpoint: 'locked', leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: now }, $inc: { fencingToken: 1 } },
    { new: true, lean: true },
  )
  if (!claimed) return null
  const job = record(claimed)
  const updated = await modelFor(payload, 'collections').updateOne(
    { _id: job.collectionId, draftState: 'publishing', revision: job.fixedCollectionRevision, lifecycle: { $ne: 'archived' } },
    { $set: { publishFencingToken: job.fencingToken, updatedAt: now } },
  )
  if (updated.modifiedCount !== 1) {
    // The collection changed (or was archived) before this worker acquired a
    // durable fence. Mark only this job stale; no retry can safely promote it.
    await jobs.updateOne(
      { _id: job.id, status: { $nin: TERMINAL } },
      { $set: { status: 'stale', checkpoint: 'collection_changed', leaseExpiresAt: null, updatedAt: new Date() } },
    )
    return null
  }
  return { job, lease: { owner, fencingToken: job.fencingToken } }
}

async function assertFence(jobs: DocumentModel, job: PublishJobRecord, lease: PublishLease, session?: ClientSession, status?: string) {
  const filter: Record<string, unknown> = { ...ownedFence(job, lease) }
  if (status) filter.status = status
  if (!await jobs.findOne(filter).session(session ?? null).lean()) throw new AdminHttpError(409, 'conflict')
}

async function applyIntervals(payload: Payload, job: PublishJobRecord, lease: PublishLease) {
  const jobs = modelFor(payload, 'collection-publish-jobs')
  const changes = modelFor(payload, 'collection-draft-changes')
  const memberships = modelFor(payload, 'collection-memberships')
  const cursor = changes.find({
    collectionId: job.collectionId, draftEpoch: job.fixedDraftEpoch, stageState: 'committed',
    targetDraftRevision: { $lte: job.fixedDraftRevision },
    $or: [{ validUntilDraftRevision: null }, { validUntilDraftRevision: { $gte: job.fixedDraftRevision } }],
  }).sort({ curationId: 1, targetDraftRevision: -1 }).cursor() as unknown as AsyncIterable<Record<string, unknown>>
  let previous: string | undefined
  for await (const change of cursor) {
    const curationId = String(change.curationId)
    if (curationId === previous) continue
    previous = curationId
    await assertFence(jobs, job, lease)
    if (change.desiredState === 'add') {
      await memberships.updateOne(
        { collectionId: job.collectionId, curationId, addedInVersion: job.targetVersion },
        { $setOnInsert: { collectionId: job.collectionId, curationId, addedInVersion: job.targetVersion, removedInVersion: null, createdBy: job.actorId, createdAt: new Date() } },
        { upsert: true },
      )
    } else {
      await memberships.updateOne(
        { collectionId: job.collectionId, curationId, removedInVersion: null },
        { $set: { removedInVersion: job.targetVersion, updatedAt: new Date() } },
      )
    }
  }
  const marked = await jobs.updateOne({ ...ownedFence(job, lease), status: 'running' }, { $set: { checkpoint: 'intervals_applied', updatedAt: new Date() } })
  if (marked.modifiedCount !== 1) throw new AdminHttpError(409, 'conflict')
}

export async function runPublishJob(
  payload: Payload,
  publishJobId: string,
  owner: string,
  client: PublishAvailabilityClient = new FastApiPublishAvailabilityClient(),
): Promise<PublishJobRecord | null> {
  const claimed = await claim(payload, publishJobId, owner)
  if (!claimed) return null
  const { job, lease } = claimed
  const jobs = modelFor(payload, 'collection-publish-jobs')
  const collections = modelFor(payload, 'collections')
  const memberships = modelFor(payload, 'collection-memberships')
  const versions = modelFor(payload, 'collection-versions')
  const audit = modelFor(payload, 'audit-events')
  try {
    await client.introspectAdmin(job.actorId)
    await assertFence(jobs, job, lease)
    const collection = await collections.findOne({ _id: job.collectionId, revision: job.fixedCollectionRevision, draftEpoch: job.fixedDraftEpoch, draftRevision: job.fixedDraftRevision, draftState: 'publishing', lifecycle: { $ne: 'archived' } }).lean() as Record<string, unknown> | null
    if (!collection) throw new TerminalPublishError('stale', 'collection_changed')
    if (!await resetTargetVersionStaging(payload, job, lease)) {
      throw new TerminalPublishError('conflicted', 'target_version_already_published')
    }
    await applyIntervals(payload, job, lease)
    const membershipHash = await computeCanonicalMembershipHash(streamMembershipAtVersion({ memberships, collectionId: job.collectionId, version: job.targetVersion }), 1)
    const availability = await inspectAvailability(
      streamMembershipAtVersion({ memberships, collectionId: job.collectionId, version: job.targetVersion }),
      (ids) => client.hydrateCurations(ids),
    )
    if (availability.unavailableCount !== job.confirmedUnavailableCount) {
      throw new TerminalPublishError('conflicted', 'unavailable_count_changed')
    }
    await assertFence(jobs, job, lease)
    await versions.updateOne(
      { collectionId: job.collectionId, version: job.targetVersion },
      { $setOnInsert: { collectionId: job.collectionId, version: job.targetVersion, metadataSnapshot: metadataSnapshot(collection), selectedCount: availability.selectedCount, membershipHash, publicationJobId: job.id, schemaVersion: 1, status: 'ready', createdAt: new Date() } },
      { upsert: true },
    )
    await jobs.updateOne({ ...ownedFence(job, lease), status: 'running' }, { $set: { status: 'committing', checkpoint: 'validated', selectedCount: availability.selectedCount, membershipHash, updatedAt: new Date() } })
    await client.introspectAdmin(job.actorId)
    await inTransaction(payload, async (session) => {
      await assertFence(jobs, job, lease, session, 'committing')
      const version = await versions.updateOne({ collectionId: job.collectionId, version: job.targetVersion, status: 'ready' }, { $set: { status: 'published', publishedAt: new Date(), publishedBy: job.actorId, updatedAt: new Date() } }, { session })
      if (version.modifiedCount !== 1) throw new TerminalPublishError('conflicted', 'version_not_ready')
      const promoted = await collections.updateOne(
        { _id: job.collectionId, revision: job.fixedCollectionRevision, draftEpoch: job.fixedDraftEpoch, draftRevision: job.fixedDraftRevision, draftState: 'publishing', lifecycle: { $ne: 'archived' }, publishFencingToken: lease.fencingToken },
        { $set: { currentPublishedVersion: job.targetVersion, lifecycle: 'published', everPublished: true, draftBaseVersion: job.targetVersion, draftEpoch: randomUUID(), draftRevision: 0, draftState: 'clean', publishedSelectedCount: availability.selectedCount, draftSelectedCount: availability.selectedCount, updatedAt: new Date() }, $inc: { revision: 1 } },
        { session },
      )
      if (promoted.modifiedCount !== 1) throw new TerminalPublishError('conflicted', 'promotion_conflict')
      const completed = await jobs.updateOne({ _id: job.id, status: 'committing', leaseOwner: lease.owner, fencingToken: lease.fencingToken }, { $set: { status: 'completed', checkpoint: 'promoted', leaseExpiresAt: null, updatedAt: new Date() } }, { session })
      if (completed.modifiedCount !== 1) throw new TerminalPublishError('conflicted', 'publish_fence_lost')
      await appendAuditEvent(audit, { actorId: job.actorId, beforeRevision: job.fixedCollectionRevision, afterRevision: job.fixedCollectionRevision + 1, collectionId: job.collectionId, eventKey: `collection.published:${job.id}`, eventType: 'collection.published', metadata: { version: job.targetVersion, selectedCount: availability.selectedCount }, publicationJobId: job.id, requestId: job.requestId }, session)
    })
  } catch (error) {
    const terminal = error instanceof TerminalPublishError
      ? error
      : error instanceof AdminHttpError && error.status === 403
        ? new TerminalPublishError('authorization_revoked', 'authorization_revoked')
        : null
    if (terminal) {
      const terminalized = await jobs.updateOne(
        { ...ownedFence(job, lease), status: { $nin: TERMINAL } },
        { $set: { status: terminal.status, checkpoint: terminal.code, leaseExpiresAt: null, updatedAt: new Date() } },
      )
      // A failed pre-promotion job never changes the public pointer. Release
      // only the exact draft/fence it held so a subsequent explicit publish can
      // retry the still-visible draft; an archive remains a kill switch.
      if (terminalized.modifiedCount === 1) {
        await collections.updateOne(
          { _id: job.collectionId, draftState: 'publishing', draftEpoch: job.fixedDraftEpoch, draftRevision: job.fixedDraftRevision, publishFencingToken: lease.fencingToken, lifecycle: { $ne: 'archived' } },
          { $set: { draftState: 'dirty', updatedAt: new Date() } },
        )
      }
    } else {
      await jobs.updateOne({ ...ownedFence(job, lease), status: { $nin: TERMINAL } }, { $set: { leaseExpiresAt: new Date(), updatedAt: new Date() } })
    }
    const current = await jobs.findById(job.id).lean()
    if (current && TERMINAL.includes(String((current as Record<string, unknown>).status))) return record(current)
    throw error
  }
  const complete = await jobs.findById(job.id).lean()
  return complete ? record(complete) : null
}

export interface RestoreVersionAsDraftDependencies {
  resolve: CatalogResolver
}

const RESTORE_BATCH_SIZE = 500

/**
 * Recreates a historical published version as a pending draft change set.
 *
 * The historical version is merge-diffed against the currently published
 * pointer in cursor/batches (never materialized), and each delta batch is
 * enqueued and applied through the regular draft-operation engine, so the
 * user can review the diff and publish it as a NEW monotonic version. The
 * published pointer is never moved here.
 *
 * Retries converge: the diff is a pure function of (version, baseVersion), so
 * re-running the same restore re-enqueues the same deltas against the draft
 * revision that now exists (idempotent at the delta level), and the audit
 * event is upserted by a stable key instead of appended.
 */
export async function restoreVersionAsDraft(
  payload: Payload,
  command: RestoreVersionAsDraftCommand,
  dependencies: Partial<RestoreVersionAsDraftDependencies> = {},
): Promise<RestoreVersionAsDraftResult> {
  assertObjectId(command.collectionId)
  if (!Number.isInteger(command.version) || command.version < 1) throw new AdminHttpError(400, 'invalid_request')
  const collections = modelFor(payload, 'collections')
  const versions = modelFor(payload, 'collection-versions')
  const memberships = modelFor(payload, 'collection-memberships')
  const audit = modelFor(payload, 'audit-events')

  const collection = await collections.findById(command.collectionId).lean() as Record<string, unknown> | null
  if (!collection) throw new AdminHttpError(404, 'not_found')
  if (collection.lifecycle === 'archived') throw new AdminHttpError(409, 'conflict')
  if (collection.draftState === 'publishing') throw new AdminHttpError(423, 'draft_locked')
  const baseVersion = typeof collection.currentPublishedVersion === 'number' ? collection.currentPublishedVersion : null
  // Without a published pointer there is nothing to diff the historical
  // version against: the draft engine only expresses deltas relative to base.
  if (baseVersion === null) throw new AdminHttpError(409, 'conflict')
  const historical = await versions.findOne({ collectionId: command.collectionId, version: command.version, status: 'published' }).lean()
  if (!historical) throw new AdminHttpError(404, 'not_found')

  const resolver = dependencies.resolve ?? new FastApiCatalogClient()
  const owner = `restore-worker-${command.requestId}`
  const operationIds: string[] = []
  let addedCount = 0
  let removedCount = 0
  let adds: string[] = []
  let removes: string[] = []

  const flush = async (action: 'add' | 'remove', curationIds: string[]) => {
    if (!curationIds.length) return
    // The draft moves under the operator: re-read it for a fresh base
    // revision so the enqueue CAS validates against the current draft state,
    // and refuse to continue if the published base moved mid-restore.
    const fresh = await collections.findById(command.collectionId).lean() as Record<string, unknown> | null
    if (!fresh) throw new AdminHttpError(404, 'not_found')
    if (fresh.lifecycle === 'archived') throw new AdminHttpError(409, 'conflict')
    if (fresh.draftState === 'publishing') throw new AdminHttpError(423, 'draft_locked')
    if (typeof fresh.currentPublishedVersion !== 'number' || fresh.currentPublishedVersion !== baseVersion) {
      throw new AdminHttpError(409, 'conflict')
    }
    const freshDraftRevision = Number(fresh.draftRevision)
    const operation = await enqueueDraftOperation(payload, {
      collectionId: command.collectionId,
      action,
      baseDraftRevision: freshDraftRevision,
      curationIds,
      idempotencyKey: `restore:${command.collectionId}:${command.version}:${action}:${baseVersion}:${freshDraftRevision}`,
      actorId: command.actorId,
      requestId: command.requestId,
    }, { resolve: resolver })
    await applyDraftOperation(payload, operation.id, owner, resolver)
    operationIds.push(operation.id)
  }

  for await (const delta of diffMembershipAtVersions({ memberships, collectionId: command.collectionId, version: command.version, baseVersion })) {
    if (delta.action === 'add') {
      addedCount += 1
      adds.push(delta.curationId)
      if (adds.length === RESTORE_BATCH_SIZE) {
        await flush('add', adds)
        adds = []
      }
    } else {
      removedCount += 1
      removes.push(delta.curationId)
      if (removes.length === RESTORE_BATCH_SIZE) {
        await flush('remove', removes)
        removes = []
      }
    }
  }
  await flush('add', adds)
  await flush('remove', removes)

  // Upsert by a stable key: a retried restore converges without duplicating
  // the audit record. `updatedAt` is omitted because mongoose auto-timestamps
  // already $set it, which would conflict with an explicit $setOnInsert.
  const now = new Date()
  await audit.updateOne(
    { eventKey: `collection.historical_version_restored_to_draft:${command.collectionId}:${command.version}` },
    {
      $setOnInsert: {
        eventKey: `collection.historical_version_restored_to_draft:${command.collectionId}:${command.version}`,
        eventType: 'collection.historical_version_restored_to_draft',
        actorId: command.actorId,
        requestId: command.requestId,
        collectionId: command.collectionId,
        metadata: { version: command.version, baseVersion, addedCount, removedCount },
        createdAt: now,
      },
    },
    { upsert: true },
  )

  return {
    collectionId: command.collectionId,
    restoredVersion: command.version,
    baseVersion,
    addedCount,
    removedCount,
    operationIds,
  }
}

/** Releases a job only after Payload exhausted its configured transient retries. */
export async function failPublishJob(payload: Payload, publishJobId: string): Promise<void> {
  const jobs = modelFor(payload, 'collection-publish-jobs')
  const job = await jobs.findOneAndUpdate(
    { _id: publishJobId, status: { $nin: TERMINAL } },
    { $set: { status: 'failed', checkpoint: 'retries_exhausted', leaseExpiresAt: null, updatedAt: new Date() } },
    { new: true, lean: true },
  ) as Record<string, unknown> | null
  if (!job) return
  await modelFor(payload, 'collections').updateOne(
    { _id: job.collectionId, draftState: 'publishing', draftEpoch: job.fixedDraftEpoch, draftRevision: job.fixedDraftRevision, lifecycle: { $ne: 'archived' } },
    { $set: { draftState: 'dirty', updatedAt: new Date() } },
  )
}