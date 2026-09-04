import type { Model } from 'mongoose'
import type { Payload, TaskConfig } from 'payload'
import { readPositiveInt } from '../retention-policy'

type DocumentModel = Model<Record<string, unknown>>

const DEFAULT_STALE_PROCESSING_MS = 3 * 60 * 1000
const DEFAULT_MAX_RECOVERIES = 3
const SCAN_LIMIT = 200

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

function stuckReason(job: Record<string, unknown>, staleBefore: Date): 'failed' | 'completed' | 'processing' | null {
  if (job.hasError === true) return 'failed'
  if (dateValue(job.completedAt)) return 'completed'
  if (job.processing === true) {
    const updatedAt = dateValue(job.updatedAt)
    if (updatedAt && updatedAt.getTime() <= staleBefore.getTime()) return 'processing'
  }
  return null
}

function recoveryCas(jobId: string, reason: 'failed' | 'completed' | 'processing', staleBefore: Date) {
  if (reason === 'failed') return { _id: jobId, hasError: true }
  if (reason === 'completed') return { _id: jobId, completedAt: { $ne: null } }
  return { _id: jobId, processing: true, updatedAt: { $lte: staleBefore } }
}

async function domainCandidates(payload: Payload, source: DomainSource, now: Date): Promise<Record<string, unknown>[]> {
  return modelFor(payload, source.slug)
    .find({
      status: { $in: source.activeStatuses },
      $or: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { $lt: now } },
      ],
      [source.jobField]: { $exists: true, $ne: null },
    })
    .sort({ updatedAt: 1, _id: 1 })
    .select({ _id: 1, [source.jobField]: 1, status: 1, leaseExpiresAt: 1, updatedAt: 1 })
    .limit(SCAN_LIMIT)
    .lean() as Promise<Record<string, unknown>[]>
}

async function terminalJobCandidates(jobs: DocumentModel, staleBefore: Date): Promise<Record<string, unknown>[]> {
  return jobs.find({
    taskSlug: { $in: DOMAIN_SOURCES.map((source) => source.taskSlug) },
    $or: [
      { hasError: true },
      { completedAt: { $exists: true, $ne: null } },
      { processing: true, updatedAt: { $lte: staleBefore } },
    ],
  }).sort({ updatedAt: 1, _id: 1 }).limit(SCAN_LIMIT).lean() as Promise<Record<string, unknown>[]>
}

async function successfulDomainForJob(
  payload: Payload,
  source: DomainSource,
  jobId: string,
): Promise<Record<string, unknown> | null> {
  return modelFor(payload, source.slug).findOne({
    [source.jobField]: jobId,
    status: { $in: source.successStatuses },
  }).lean() as Promise<Record<string, unknown> | null>
}

async function reopenJob(
  jobs: DocumentModel,
  job: Record<string, unknown>,
  reason: 'failed' | 'completed' | 'processing',
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
        completedAt: null,
        taskStatus: null,
        totalTried: 0,
        waitUntil: now,
        meta: {
          ...priorMeta,
          recoveryCount: priorRecoveries + 1,
          recoveredAt: now.toISOString(),
          recoveryReason: reason,
          ...(recoveredAfterDomainSuccess ? { recoveredAfterDomainSuccess: true } : {}),
        },
        updatedAt: now,
      },
    },
  )
  return changed.modifiedCount === 1 ? 'recovered' : 'raced'
}

/**
 * Re-opens only the SAME Payload job when it is provably stuck. Active domain
 * intents are age-ordered and require a reclaimable domain lease; missing jobs
 * remain operator-visible corruption and are never reconstructed.
 *
 * Payload 3.86 uses a permanent `processing` boolean. A worker can therefore
 * crash after committing the durable domain success but before Payload marks
 * or deletes its internal job. Scanning every historical successful domain
 * would starve forever, so this second path starts from the small set of stuck
 * `payload-jobs`, maps only the four domain task slugs, and reopens a job only
 * after its linked domain record proves a success terminal. The rerun is
 * idempotent and lets configured `deleteJobOnComplete` finish internal cleanup.
 */
export async function reconcileRecoverableJobs(
  payload: Payload,
  now = new Date(),
  options: RecoveryOptions = {},
): Promise<RecoverySummary> {
  const staleProcessingMs = options.staleProcessingMs ?? DEFAULT_STALE_PROCESSING_MS
  const maxRecoveries = options.maxRecoveries ?? DEFAULT_MAX_RECOVERIES
  const staleBefore = new Date(now.getTime() - staleProcessingMs)
  const jobs = modelFor(payload, 'payload-jobs')
  const summary: RecoverySummary = { recovered: 0, healthy: 0, exhausted: 0, missing: 0 }

  for (const source of DOMAIN_SOURCES) {
    const candidates = await domainCandidates(payload, source, now)
    for (const domain of candidates) {
      const jobId = String(domain[source.jobField] ?? '')
      if (!jobId) continue
      const job = await jobs.findById(jobId).lean() as Record<string, unknown> | null
      if (!job) {
        summary.missing += 1
        continue
      }

      const reason = stuckReason(job, staleBefore)
      if (!reason) {
        summary.healthy += 1
        continue
      }

      const outcome = await reopenJob(jobs, job, reason, staleBefore, now, maxRecoveries, false)
      if (outcome === 'recovered') summary.recovered += 1
      else if (outcome === 'exhausted') summary.exhausted += 1
      else summary.healthy += 1
    }
  }

  const terminalJobs = await terminalJobCandidates(jobs, staleBefore)
  for (const job of terminalJobs) {
    const source = SOURCE_BY_TASK.get(String(job.taskSlug ?? ''))
    const jobId = String(job.id ?? job._id ?? '')
    if (!source || !jobId) continue
    const domain = await successfulDomainForJob(payload, source, jobId)
    if (!domain) continue // active-domain path or unrelated historical job
    const reason = stuckReason(job, staleBefore)
    if (!reason) continue

    const outcome = await reopenJob(jobs, job, reason, staleBefore, now, maxRecoveries, true)
    if (outcome === 'recovered') summary.recovered += 1
    else if (outcome === 'exhausted') summary.exhausted += 1
    else summary.healthy += 1
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
