import type { Model } from 'mongoose'
import type { Payload, TaskConfig } from 'payload'
import { readPositiveInt } from '../retention-policy'

type DocumentModel = Model<Record<string, unknown>>

const DEFAULT_STALE_PROCESSING_MS = 3 * 60 * 1000
const DEFAULT_MAX_RECOVERIES = 3
const SCAN_LIMIT = 200
const PAYLOAD_JOB_SLUG = 'payload-jobs'

type StuckReason = 'failed' | 'completed' | 'processing'

interface RecoveryOptions {
  staleProcessingMs?: number
  maxRecoveries?: number
}

export interface RecoverySummary {
  recovered: number
  healthy: number
  exhausted: number
  missing: number
}

type DomainSource = {
  slug: string
  jobField: 'jobId' | 'payloadJobId'
  taskSlug: string
  activeStatuses: string[]
  successStatuses: string[]
}

const DOMAIN_SOURCES: readonly DomainSource[] = [
  {
    slug: 'collection-operations',
    jobField: 'jobId',
    taskSlug: 'apply-draft-operation',
    activeStatuses: ['queued', 'materializing', 'staging', 'validating', 'committing'],
    successStatuses: ['committed', 'completed', 'completed_with_skips'],
  },
  {
    slug: 'collection-publish-jobs',
    jobField: 'payloadJobId',
    taskSlug: 'publish-collection',
    activeStatuses: ['queued', 'running', 'committing'],
    successStatuses: ['completed'],
  },
  {
    slug: 'selection-manifests',
    jobField: 'payloadJobId',
    taskSlug: 'materialize-selection',
    activeStatuses: ['queued', 'materializing'],
    successStatuses: ['ready'],
  },
  {
    slug: 'collection-exports',
    jobField: 'payloadJobId',
    taskSlug: 'export-selection',
    activeStatuses: ['queued', 'running'],
    successStatuses: ['complete'],
  },
]
const SOURCE_BY_TASK = new Map(DOMAIN_SOURCES.map((source) => [source.taskSlug, source]))

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function recoveryCount(job: Record<string, unknown>): number {
  const meta = job.meta
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return 0
  const count = Number((meta as Record<string, unknown>).recoveryCount ?? 0)
  return Number.isInteger(count) && count >= 0 ? count : 0
}

function dateValue(value: unknown): Date | null {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function stuckReason(job: Record<string, unknown>, staleBefore: Date): StuckReason | null {
  if (job.hasError === true) return 'failed'
  if (dateValue(job.completedAt)) return 'completed'
  if (job.processing === true) {
    const updatedAt = dateValue(job.updatedAt)
    if (updatedAt && updatedAt.getTime() <= staleBefore.getTime()) return 'processing'
  }
  return null
}

function recoveryCas(jobId: string, reason: StuckReason, staleBefore: Date) {
  if (reason === 'failed') return { _id: jobId, hasError: true }
  if (reason === 'completed') return { _id: jobId, completedAt: { $ne: null } }
  return { _id: jobId, processing: true, updatedAt: { $lte: staleBefore } }
}

function leaseReclaimable(domain: Record<string, unknown>, now: Date): boolean {
  if (domain.leaseExpiresAt === null || domain.leaseExpiresAt === undefined) return true
  const lease = dateValue(domain.leaseExpiresAt)
  return Boolean(lease && lease.getTime() < now.getTime())
}

async function stuckJobCandidates(jobs: DocumentModel, staleBefore: Date): Promise<Record<string, unknown>[]> {
  const rows = await jobs.find({
    taskSlug: { $in: DOMAIN_SOURCES.map((source) => source.taskSlug) },
    'meta.recoveryIgnoredAt': { $exists: false },
    $or: [
      { hasError: true },
      { completedAt: { $exists: true, $ne: null } },
      { processing: true, updatedAt: { $lte: staleBefore } },
    ],
  }).sort({ updatedAt: 1, _id: 1 }).limit(SCAN_LIMIT).lean()
  return rows as Record<string, unknown>[]
}

async function domainForJob(
  payload: Payload,
  source: DomainSource,
  jobId: string,
): Promise<Record<string, unknown> | null> {
  const row = await modelFor(payload, source.slug)
    .findOne({ [source.jobField]: jobId })
    .select({ _id: 1, [source.jobField]: 1, status: 1, leaseExpiresAt: 1 })
    .lean()
  return row as Record<string, unknown> | null
}

/**
 * Detects active/reclaimable domain intents whose Payload job reference is
 * missing. The lookup/missing predicate runs before the limit, so thousands of
 * healthy old intents cannot hide a corrupt newer row from this diagnostic.
 * The physical Mongo collection name is taken from the live Mongoose model;
 * recovery does not assume how Payload pluralizes the `payload-jobs` slug.
 */
async function missingDomainCandidates(
  payload: Payload,
  source: DomainSource,
  now: Date,
  jobsCollectionName: string,
): Promise<Record<string, unknown>[]> {
  const rows = await modelFor(payload, source.slug).aggregate([
    {
      $match: {
        status: { $in: source.activeStatuses },
        $or: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { $lt: now } },
        ],
        [source.jobField]: { $exists: true, $ne: null },
      },
    },
    {
      $lookup: {
        from: jobsCollectionName,
        localField: source.jobField,
        foreignField: '_id',
        as: '_recoveryJob',
      },
    },
    { $match: { '_recoveryJob.0': { $exists: false } } },
    { $sort: { updatedAt: 1, _id: 1 } },
    { $limit: SCAN_LIMIT },
    { $project: { _id: 1 } },
  ])
  return rows as Record<string, unknown>[]
}

async function classifyIgnoredJob(
  jobs: DocumentModel,
  job: Record<string, unknown>,
  reason: StuckReason,
  staleBefore: Date,
  now: Date,
  ignoredReason: 'domain_missing' | 'domain_terminal_failure',
  domainStatus: string | null,
): Promise<void> {
  const jobId = String(job.id ?? job._id ?? '')
  if (!jobId) return
  await jobs.updateOne(
    {
      ...recoveryCas(jobId, reason, staleBefore),
      'meta.recoveryIgnoredAt': { $exists: false },
    },
    {
      $set: {
        'meta.recoveryIgnoredAt': now.toISOString(),
        'meta.recoveryIgnoredReason': ignoredReason,
        'meta.recoveryIgnoredDomainStatus': domainStatus,
        updatedAt: now,
      },
    },
  )
}

async function reopenJob(
  jobs: DocumentModel,
  job: Record<string, unknown>,
  reason: StuckReason,
  staleBefore: Date,
  now: Date,
  maxRecoveries: number,
  recoveredAfterDomainSuccess: boolean,
): Promise<'recovered' | 'exhausted' | 'raced'> {
  const jobId = String(job.id ?? job._id ?? '')
  if (!jobId) return 'raced'
  const priorRecoveries = recoveryCount(job)
  if (priorRecoveries >= maxRecoveries) return 'exhausted'

  const priorMeta = job.meta && typeof job.meta === 'object' && !Array.isArray(job.meta)
    ? job.meta as Record<string, unknown>
    : {}
  const changed = await jobs.updateOne(
    recoveryCas(jobId, reason, staleBefore),
    {
      $set: {
        processing: false,
        hasError: false,
        error: null,
        totalTried: 0,
        meta: {
          ...priorMeta,
          recoveryCount: priorRecoveries + 1,
          recoveredAt: now.toISOString(),
          recoveryReason: reason,
          ...(recoveredAfterDomainSuccess ? { recoveredAfterDomainSuccess: true } : {}),
        },
        updatedAt: now,
      },
      // Payload 3.86 selects runnable jobs with `completedAt exists:false` and
      // `waitUntil exists:false OR < now`. Setting either field to null leaves
      // it physically present in Mongo and does not satisfy the first predicate.
      // Unset both so the recovered SAME job is immediately eligible.
      $unset: { completedAt: 1, waitUntil: 1 },
    },
  )
  return changed.modifiedCount === 1 ? 'recovered' : 'raced'
}

/**
 * Re-opens only the SAME Payload job when it is provably stuck. Recovery starts
 * from stuck `payload-jobs`, not from an arbitrary slice of domain history, so
 * healthy queued/backoff intents cannot consume the bounded scan and starve a
 * newer crashed job.
 *
 * For an active domain intent, the domain lease must already be reclaimable.
 * For a durable success terminal, rerunning the same task is safe/idempotent and
 * allows Payload 3.86 to finish its own completion/delete lifecycle after a
 * crash between domain commit and internal job cleanup.
 *
 * Historical failed/missing domain jobs are classified once in job metadata and
 * excluded from later scans; they remain stored for investigation but cannot
 * permanently occupy the first 200 recovery slots. Separately, a lookup-based
 * diagnostic counts active reclaimable domains whose job document is missing;
 * it never reconstructs a missing job automatically.
 */
export async function reconcileRecoverableJobs(
  payload: Payload,
  now = new Date(),
  options: RecoveryOptions = {},
): Promise<RecoverySummary> {
  const staleProcessingMs = options.staleProcessingMs ?? DEFAULT_STALE_PROCESSING_MS
  const maxRecoveries = options.maxRecoveries ?? DEFAULT_MAX_RECOVERIES
  const staleBefore = new Date(now.getTime() - staleProcessingMs)
  const jobs = modelFor(payload, PAYLOAD_JOB_SLUG)
  const jobsCollectionName = jobs.collection.name
  if (!jobsCollectionName) throw new Error('Payload jobs Mongo collection name unavailable')
  const summary: RecoverySummary = { recovered: 0, healthy: 0, exhausted: 0, missing: 0 }

  const stuckJobs = await stuckJobCandidates(jobs, staleBefore)
  for (const job of stuckJobs) {
    const source = SOURCE_BY_TASK.get(String(job.taskSlug ?? ''))
    const jobId = String(job.id ?? job._id ?? '')
    if (!source || !jobId) continue
    const reason = stuckReason(job, staleBefore)
    if (!reason) continue

    const domain = await domainForJob(payload, source, jobId)
    if (!domain) {
      await classifyIgnoredJob(jobs, job, reason, staleBefore, now, 'domain_missing', null)
      continue
    }

    const domainStatus = String(domain.status ?? '')
    const success = source.successStatuses.includes(domainStatus)
    const active = source.activeStatuses.includes(domainStatus)

    if (!success && !active) {
      await classifyIgnoredJob(
        jobs,
        job,
        reason,
        staleBefore,
        now,
        'domain_terminal_failure',
        domainStatus || null,
      )
      continue
    }

    if (active && !leaseReclaimable(domain, now)) {
      summary.healthy += 1
      continue
    }

    const outcome = await reopenJob(jobs, job, reason, staleBefore, now, maxRecoveries, success)
    if (outcome === 'recovered') summary.recovered += 1
    else if (outcome === 'exhausted') summary.exhausted += 1
    else summary.healthy += 1
  }

  for (const source of DOMAIN_SOURCES) {
    const missing = await missingDomainCandidates(payload, source, now, jobsCollectionName)
    summary.missing += missing.length
  }

  return summary
}

export const reconcileLeasesTask: TaskConfig<{
  input: Record<string, never>
  output: RecoverySummary
}> = {
  slug: 'reconcile-leases',
  inputSchema: [],
  outputSchema: [
    { name: 'recovered', type: 'number', required: true },
    { name: 'healthy', type: 'number', required: true },
    { name: 'exhausted', type: 'number', required: true },
    { name: 'missing', type: 'number', required: true },
  ],
  schedule: [{ cron: '*/5 * * * *', queue: 'maintenance' }],
  handler: async ({ req }) => ({
    output: await reconcileRecoverableJobs(req.payload, new Date(), {
      staleProcessingMs: readPositiveInt('CMS_JOB_RECOVERY_STALE_SECONDS', DEFAULT_STALE_PROCESSING_MS / 1000) * 1000,
      maxRecoveries: readPositiveInt('CMS_JOB_MAX_RECOVERIES', DEFAULT_MAX_RECOVERIES),
    }),
  }),
}
