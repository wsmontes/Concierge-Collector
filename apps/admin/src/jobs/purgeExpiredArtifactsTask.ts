'use server'

import type { Model } from 'mongoose'
import type { Payload, TaskConfig } from 'payload'
import type { ArtifactStore } from '../storage/artifact-store'
import { createS3ArtifactStore } from '../storage/s3-artifact-store'

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
const DEFAULT_EXPORT_PURGE_BATCH_SIZE = 100

export interface OrphanStagingPurgeSummary {
  scanned: number
  deleted: number
  preserved: number
}

export interface OrphanStagingPurgeOptions {
  retentionDays?: number
  batchSize?: number
}

export interface ExportPurgeSummary {
  scanned: number
  deleted: number
  preserved: number
}

export interface ExportPurgeOptions {
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
 * Purges expired export references conservatively. When an artifact key exists,
 * object storage is deleted first; the CMS reference is removed only after the
 * DeleteObject call succeeds. A failed storage cleanup therefore remains
 * visible/retryable instead of becoming an untraceable orphan object.
 *
 * Queued/running exports are never selected even if their expiry timestamp has
 * passed: recovery/reconciliation owns those nonterminal records.
 */
export async function purgeExpiredExports(
  payload: Payload,
  store: ArtifactStore | null,
  now = new Date(),
  options: ExportPurgeOptions = {},
): Promise<ExportPurgeSummary> {
  const batchSize = options.batchSize ?? DEFAULT_EXPORT_PURGE_BATCH_SIZE
  const exportsModel = modelFor(payload, 'collection-exports')
  const candidates = await exportsModel.find({
    expiresAt: { $lte: now },
    status: { $in: ['complete', 'failed'] },
  }).sort({ expiresAt: 1, _id: 1 }).limit(batchSize).lean() as Record<string, unknown>[]

  let deleted = 0
  let preserved = 0
  let resolvedStore = store

  for (const row of candidates) {
    const id = row.id ?? row._id
    if (id === null || id === undefined) {
      preserved += 1
      continue
    }
    const key = typeof row.key === 'string' && row.key ? row.key : null
    try {
      if (key) {
        resolvedStore ??= createS3ArtifactStore()
        await resolvedStore.delete(key)
      }
      const result = await exportsModel.deleteOne({
        _id: id,
        expiresAt: { $lte: now },
        status: row.status,
      })
      if (Number(result.deletedCount ?? 0) === 1) deleted += 1
      else preserved += 1
    } catch {
      // Fail safe: retain the CMS record so maintenance can retry and operators
      // still have the object key/evidence needed to investigate storage.
      preserved += 1
    }
  }

  return { scanned: candidates.length, deleted, preserved }
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
  output: {
    exportScanned: number
    exportDeleted: number
    exportPreserved: number
    stagingScanned: number
    stagingDeleted: number
    stagingPreserved: number
  }
}> = {
  slug: 'purge-expired-artifacts',
  inputSchema: [],
  outputSchema: [
    { name: 'exportScanned', type: 'number', required: true },
    { name: 'exportDeleted', type: 'number', required: true },
    { name: 'exportPreserved', type: 'number', required: true },
    { name: 'stagingScanned', type: 'number', required: true },
    { name: 'stagingDeleted', type: 'number', required: true },
    { name: 'stagingPreserved', type: 'number', required: true },
  ],
  schedule: [{ cron: '17 3 * * *', queue: 'maintenance' }],
  handler: async ({ req }) => {
    const now = new Date()
    const exportsSummary = await purgeExpiredExports(req.payload, null, now, {
      batchSize: positiveInt('CMS_EXPORT_PURGE_BATCH_SIZE', DEFAULT_EXPORT_PURGE_BATCH_SIZE),
    })
    const stagingSummary = await purgeOrphanStaging(req.payload, now, {
      retentionDays: positiveInt('CMS_ORPHAN_STAGING_RETENTION_DAYS', DEFAULT_RETENTION_DAYS),
      batchSize: positiveInt('CMS_ORPHAN_STAGING_BATCH_SIZE', DEFAULT_BATCH_SIZE),
    })
    return {
      output: {
        exportScanned: exportsSummary.scanned,
        exportDeleted: exportsSummary.deleted,
        exportPreserved: exportsSummary.preserved,
        stagingScanned: stagingSummary.scanned,
        stagingDeleted: stagingSummary.deleted,
        stagingPreserved: stagingSummary.preserved,
      },
    }
  },
}
