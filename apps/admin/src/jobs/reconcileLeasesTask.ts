import type { Model } from 'mongoose'
import type { Payload, TaskConfig } from 'payload'

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
  statuses: string[]
}

const DOMAIN_SOURCES: readonly DomainSource[] = [
  {
    slug: 'collection-operations',
    jobField: 'jobId',
    statuses: ['queued', 'materializing', 'staging', 'validating', 'committing'],
  },
  {
    slug: 'collection-publish-jobs',
    jobField: 'payloadJobId',
    statuses: ['queued', 'running', 'committing'],
  },
  {
    slug: 'selection-manifests',
    jobField: 'payloadJobId',
    statuses: ['queued', 'materializing'],
  },
  {
    slug: 'collection-exports',
    jobField: 'payloadJobId',
    statuses: ['queued', 'running'],
  },
]

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
      status: { $in: source.statuses },
      $or: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { $lt: now } },
      ],
      [source.jobField]: { $exists: true, $ne: null },
    })
    .select({ _id: 1, [source.jobField]: 1, status: 1, leaseExpiresAt: 1 })
    .limit(SCAN_LIMIT)
    .lean() as Promise<Record<string, unknown>[]>
}

/**
 * Re-opens only Payload jobs that are provably stuck while their domain lease
 * is already reclaimable. Healthy queued/backoff jobs are untouched. The same
 * Payload job ID and domain checkpoint are preserved, and a bounded recovery
 * counter prevents an unavailable dependency from creating an infinite loop.
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
        // Missing job records are evidence of corruption/manual deletion. Do
        // not reconstruct them automatically: the domain intent is preserved
        // for operator investigation and no data is discarded.
        summary.missing += 1
        continue
      }

      const reason = stuckReason(job, staleBefore)
      if (!reason) {
        summary.healthy += 1
        continue
      }

      const priorRecoveries = recoveryCount(job)
      if (priorRecoveries >= maxRecoveries) {
        summary.exhausted += 1
        continue
      }

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
            },
            updatedAt: now,
          },
        },
      )
      if (changed.modifiedCount === 1) summary.recovered += 1
      else summary.healthy += 1 // another runner/reconciler won the race
    }
  }

  return summary
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
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
      staleProcessingMs: positiveInt('CMS_JOB_RECOVERY_STALE_SECONDS', DEFAULT_STALE_PROCESSING_MS / 1000) * 1000,
      maxRecoveries: positiveInt('CMS_JOB_MAX_RECOVERIES', DEFAULT_MAX_RECOVERIES),
    }),
  }),
}
