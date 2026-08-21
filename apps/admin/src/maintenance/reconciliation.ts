import type { Model } from 'mongoose'
import type { Payload } from 'payload'
import { cutoff, readRetentionPolicy } from './retention'

type DocumentModel = Model<Record<string, unknown>>

const ACTIVE_OPERATION_STATES = new Set(['queued', 'materializing', 'staging', 'validating', 'committing'])
const ACTIVE_PUBLISH_STATES = ['queued', 'running', 'committing']

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

export function isResumableOperation(operation: { status?: unknown } | null): boolean {
  return Boolean(operation && ACTIVE_OPERATION_STATES.has(String(operation.status)))
}

export function shouldDeleteOrphanStage(input: {
  operation: { status?: unknown } | null
  hasActivePublish: boolean
}): boolean {
  return !isResumableOperation(input.operation) && !input.hasActivePublish
}

interface JobSpec {
  id: string
  taskSlug: string
  queue: string
  input: Record<string, string>
}

async function resetPayloadJob(jobs: DocumentModel, spec: JobSpec, now: Date): Promise<void> {
  if (!spec.id) throw new Error(`Cannot reconcile ${spec.taskSlug}: missing Payload job id`)
  const result = await jobs.updateOne(
    { _id: spec.id },
    {
      $set: {
        input: spec.input,
        taskSlug: spec.taskSlug,
        queue: spec.queue,
        processing: false,
        totalTried: 0,
        hasError: false,
        completedAt: null,
        updatedAt: now,
      },
      $unset: { error: 1 },
    },
  )
  if (result.matchedCount) return
  await jobs.create([{
    _id: spec.id,
    input: spec.input,
    taskSlug: spec.taskSlug,
    queue: spec.queue,
    processing: false,
    totalTried: 0,
    hasError: false,
    createdAt: now,
    updatedAt: now,
  }])
}

async function reclaimExpired(
  payload: Payload,
  options: {
    slug: string
    statuses: string[]
    now: Date
    toQueued?: Record<string, unknown>
    job(document: Record<string, unknown>): JobSpec
  },
): Promise<number> {
  const model = modelFor(payload, options.slug)
  const jobs = modelFor(payload, 'payload-jobs')
  const candidates = await model.find({
    status: { $in: options.statuses },
    leaseExpiresAt: { $lt: options.now },
  }).sort({ leaseExpiresAt: 1, _id: 1 }).limit(500).lean() as Record<string, unknown>[]

  let reclaimed = 0
  for (const candidate of candidates) {
    const id = candidate._id
    const previousLease = candidate.leaseExpiresAt
    const updated = await model.findOneAndUpdate(
      {
        _id: id,
        status: { $in: options.statuses },
        leaseExpiresAt: previousLease,
      },
      {
        $set: {
          status: 'queued',
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: options.now,
          ...(options.toQueued ?? {}),
        },
        $inc: { fencingToken: 1 },
      },
      { new: true, lean: true },
    ) as Record<string, unknown> | null
    if (!updated) continue
    await resetPayloadJob(jobs, options.job(updated), options.now)
    reclaimed += 1
  }
  return reclaimed
}

export async function purgeOrphanStages(payload: Payload, now: Date = new Date()): Promise<number> {
  const policy = readRetentionPolicy()
  const changes = modelFor(payload, 'collection-draft-changes')
  const operations = modelFor(payload, 'collection-operations')
  const publishJobs = modelFor(payload, 'collection-publish-jobs')
  const olderThan = cutoff(now, policy.orphanStagingRetentionDays, 'days')
  const candidates = await changes.find({
    stageState: 'staged',
    createdAt: { $lt: olderThan },
  }).sort({ createdAt: 1, _id: 1 }).limit(1000).lean() as Record<string, unknown>[]

  let deleted = 0
  for (const stage of candidates) {
    const operationId = String(stage.operationId ?? '')
    const collectionId = String(stage.collectionId ?? '')
    const operation = operationId
      ? await operations.findById(operationId).lean() as Record<string, unknown> | null
      : null
    const activePublish = collectionId
      ? await publishJobs.exists({ collectionId, status: { $in: ACTIVE_PUBLISH_STATES } })
      : null
    if (!shouldDeleteOrphanStage({ operation, hasActivePublish: Boolean(activePublish) })) continue

    const result = await changes.deleteOne({ _id: stage._id, stageState: 'staged' })
    deleted += result.deletedCount
  }
  return deleted
}

export interface ReconciliationResult {
  operations: number
  publishJobs: number
  selections: number
  exports: number
  orphanStagesPurged: number
}

/**
 * Reclaim expired leases without replacing logical job identities. Each CMS
 * record is CASed on its observed lease expiry and gets a new fencing token;
 * the existing Payload job is reset (or recreated under the same ID) while the
 * domain checkpoint/progress remains untouched for resumability.
 */
export async function reconcileLeases(payload: Payload, now: Date = new Date()): Promise<ReconciliationResult> {
  const operations = await reclaimExpired(payload, {
    slug: 'collection-operations',
    statuses: [...ACTIVE_OPERATION_STATES].filter((status) => status !== 'queued'),
    now,
    job: (doc) => ({
      id: String(doc.jobId ?? ''),
      taskSlug: 'apply-draft-operation',
      queue: 'collection-mutations',
      input: { operationId: String(doc._id) },
    }),
  })
  const publishJobs = await reclaimExpired(payload, {
    slug: 'collection-publish-jobs',
    statuses: ['running', 'committing'],
    now,
    job: (doc) => ({
      id: String(doc.payloadJobId ?? ''),
      taskSlug: 'publish-collection',
      queue: 'collection-publications',
      input: { publishJobId: String(doc._id) },
    }),
  })
  const selections = await reclaimExpired(payload, {
    slug: 'selection-manifests',
    statuses: ['materializing'],
    now,
    job: (doc) => ({
      id: String(doc.payloadJobId ?? ''),
      taskSlug: 'materialize-selection',
      queue: 'selection-materialization',
      input: { selectionId: String(doc._id) },
    }),
  })
  const exports = await reclaimExpired(payload, {
    slug: 'collection-exports',
    statuses: ['running'],
    now,
    job: (doc) => ({
      id: String(doc.payloadJobId ?? ''),
      taskSlug: 'export-selection',
      queue: 'selection-exports',
      input: { selectionId: String(doc.selectionId ?? ''), exportId: String(doc._id) },
    }),
  })

  return {
    operations,
    publishJobs,
    selections,
    exports,
    orphanStagesPurged: await purgeOrphanStages(payload, now),
  }
}
