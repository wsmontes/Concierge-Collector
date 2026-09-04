'use server'

import type { Model } from 'mongoose'
import type { Payload, TaskConfig } from 'payload'

type DocumentModel = Model<Record<string, unknown>>

const TERMINAL_OPERATIONS = [
  'committed',
  'completed',
  'completed_with_skips',
  'failed',
  'cancelled',
  'stale',
  'conflicted',
  'authorization_revoked',
]
const DEFAULT_RETENTION_DAYS = 30
const DEFAULT_BATCH_SIZE = 500

export interface OrphanStagingPurgeSummary {
  scanned: number
  deleted: number
  preserved: number
}

export interface OrphanStagingPurgeOptions {
  retentionDays?: number
  batchSize?: number
}

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

/**
 * Removes only staging rows old enough to be operational garbage and whose
 * owning operation is either terminal or no longer exists. Any nonterminal
 * operation — including an exhausted/missing Payload job that still requires
 * operator recovery — protects all of its staging rows from deletion.
 */
export async function purgeOrphanStaging(
  payload: Payload,
  now = new Date(),
  options: OrphanStagingPurgeOptions = {},
): Promise<OrphanStagingPurgeSummary> {
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  const changes = modelFor(payload, 'collection-draft-changes')
  const operations = modelFor(payload, 'collection-operations')

  const candidates = await changes.find({
    stageState: 'staged',
    updatedAt: { $lt: cutoff },
  }).select({ _id: 1, operationId: 1 }).limit(batchSize).lean() as Record<string, unknown>[]

  if (candidates.length === 0) return { scanned: 0, deleted: 0, preserved: 0 }

  const operationIds = [...new Set(candidates.map((row) => String(row.operationId ?? '')).filter(Boolean))]
  const resumable = operationIds.length === 0
    ? []
    : await operations.find({
      _id: { $in: operationIds },
      status: { $nin: TERMINAL_OPERATIONS },
    }).select({ _id: 1, status: 1 }).lean() as Record<string, unknown>[]
  const protectedIds = new Set(resumable.map((operation) => String(operation.id ?? operation._id)))
  const deletableIds = candidates
    .filter((row) => !protectedIds.has(String(row.operationId ?? '')))
    .map((row) => row.id ?? row._id)
    .filter((id): id is NonNullable<unknown> => id !== null && id !== undefined)

  let deleted = 0
  if (deletableIds.length > 0) {
    const result = await changes.deleteMany({
      _id: { $in: deletableIds },
      stageState: 'staged',
    })
    deleted = Number(result.deletedCount ?? 0)
  }

  return {
    scanned: candidates.length,
    deleted,
    preserved: candidates.length - deletableIds.length,
  }
}

export const purgeExpiredArtifactsTask: TaskConfig<{
  input: Record<string, never>
  output: OrphanStagingPurgeSummary
}> = {
  slug: 'purge-expired-artifacts',
  inputSchema: [],
  outputSchema: [
    { name: 'scanned', type: 'number', required: true },
    { name: 'deleted', type: 'number', required: true },
    { name: 'preserved', type: 'number', required: true },
  ],
  schedule: [{ cron: '17 3 * * *', queue: 'maintenance' }],
  handler: async ({ req }) => ({
    output: await purgeOrphanStaging(req.payload, new Date(), {
      retentionDays: positiveInt('CMS_ORPHAN_STAGING_RETENTION_DAYS', DEFAULT_RETENTION_DAYS),
      batchSize: positiveInt('CMS_ORPHAN_STAGING_BATCH_SIZE', DEFAULT_BATCH_SIZE),
    }),
  }),
}
