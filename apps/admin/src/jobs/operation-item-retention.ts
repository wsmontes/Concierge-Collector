'use server'

import { createHash } from 'node:crypto'
import type { Model } from 'mongoose'
import type { Payload } from 'payload'

type DocumentModel = Model<Record<string, unknown>>

const TERMINAL_OPERATION_STATUSES = [
  'committed',
  'completed',
  'completed_with_skips',
  'failed',
  'cancelled',
  'stale',
  'conflicted',
  'authorization_revoked',
] as const

const DEFAULT_RETENTION_DAYS = 90
const DEFAULT_BATCH_SIZE = 100

export interface OperationItemRetentionOptions {
  retentionDays?: number
  batchSize?: number
}

export interface OperationItemCompactionSummary {
  scannedOperations: number
  compactedOperations: number
  deletedItems: number
  preservedOperations: number
}

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function dateValue(value: unknown): Date | null {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function canonicalLine(row: Record<string, unknown>): string {
  return JSON.stringify({
    curationId: row.curationId,
    desiredState: row.desiredState,
    status: row.status,
    reasonCode: row.reasonCode ?? null,
    targetDraftRevision: row.targetDraftRevision,
  })
}

function increment(target: Record<string, number>, key: string | null) {
  if (!key) return
  target[key] = (target[key] ?? 0) + 1
}

function evidenceFor(rows: Record<string, unknown>[]) {
  const digest = createHash('sha256')
  const statusCounts: Record<string, number> = {}
  const reasonCounts: Record<string, number> = {}
  for (const row of rows) {
    digest.update(`${canonicalLine(row)}\n`)
    increment(statusCounts, typeof row.status === 'string' ? row.status : null)
    increment(reasonCounts, typeof row.reasonCode === 'string' ? row.reasonCode : null)
  }
  return {
    itemCount: rows.length,
    statusCounts,
    reasonCounts,
    sha256: digest.digest('hex'),
  }
}

function existingArchive(operation: Record<string, unknown>): Record<string, unknown> | null {
  const value = operation.itemArchive
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function sameCounts(left: unknown, right: Record<string, number>): boolean {
  if (!left || typeof left !== 'object' || Array.isArray(left)) return false
  const normalized = Object.fromEntries(
    Object.entries(left as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'number')
      .map(([key, value]) => [key, Number(value)]),
  )
  return JSON.stringify(Object.entries(normalized).sort()) === JSON.stringify(Object.entries(right).sort())
}

function archiveMatches(archive: Record<string, unknown>, evidence: ReturnType<typeof evidenceFor>): boolean {
  return Number(archive.itemCount) === evidence.itemCount
    && archive.sha256 === evidence.sha256
    && sameCounts(archive.statusCounts, evidence.statusCounts)
    && sameCounts(archive.reasonCounts, evidence.reasonCounts)
}

async function markPurgeStarted(
  operations: DocumentModel,
  operation: Record<string, unknown>,
  sha256: string,
  now: Date,
): Promise<boolean> {
  const marked = await operations.updateOne(
    {
      _id: operation.id ?? operation._id,
      status: operation.status,
      'itemArchive.sha256': sha256,
      'itemArchive.purgeStartedAt': { $exists: false },
      'itemArchive.itemsPurgedAt': { $exists: false },
    },
    { $set: { 'itemArchive.purgeStartedAt': now.toISOString() } },
  )
  return Number(marked.modifiedCount ?? 0) === 1
}

async function markItemsPurged(
  operations: DocumentModel,
  operation: Record<string, unknown>,
  sha256: string,
  now: Date,
  purgedItemCount: number,
): Promise<boolean> {
  const marked = await operations.updateOne(
    {
      _id: operation.id ?? operation._id,
      status: operation.status,
      'itemArchive.sha256': sha256,
      'itemArchive.purgeStartedAt': { $exists: true },
      'itemArchive.itemsPurgedAt': { $exists: false },
    },
    {
      $set: {
        'itemArchive.itemsPurgedAt': now.toISOString(),
        'itemArchive.purgedItemCount': purgedItemCount,
      },
    },
  )
  return Number(marked.modifiedCount ?? 0) === 1
}

/**
 * Bounds the high-cardinality per-item operation table without losing the
 * evidence needed to verify an old operation. Only terminal parents older than
 * the retention window are eligible. A deterministic digest/count summary is
 * persisted on the parent under CAS before any item row is deleted.
 *
 * `purgeStartedAt` is persisted before the first destructive write. Before that
 * marker, raw detail must still match the immutable summary exactly. After the
 * marker, a subset of rows is an expected interrupted-delete state, so later
 * maintenance runs delete whatever remains for the same operationId and finish
 * `itemsPurgedAt` without recalculating or mutating the original evidence.
 */
export async function compactTerminalOperationItems(
  payload: Payload,
  now = new Date(),
  options: OperationItemRetentionOptions = {},
): Promise<OperationItemCompactionSummary> {
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  const operations = modelFor(payload, 'collection-operations')
  const itemsModel = modelFor(payload, 'collection-operation-items')

  const candidates = await operations.find({
    status: { $in: [...TERMINAL_OPERATION_STATUSES] },
    updatedAt: { $lt: cutoff },
    'itemArchive.itemsPurgedAt': { $exists: false },
  }).sort({ updatedAt: 1, _id: 1 }).limit(batchSize).lean() as Record<string, unknown>[]

  let compactedOperations = 0
  let deletedItems = 0
  let preservedOperations = 0

  for (const operation of candidates) {
    const operationId = String(operation.id ?? operation._id ?? '')
    const updatedAt = dateValue(operation.updatedAt)
    const status = typeof operation.status === 'string' ? operation.status : ''
    if (!operationId || !updatedAt || !TERMINAL_OPERATION_STATUSES.includes(status as never)) {
      preservedOperations += 1
      continue
    }

    const rows = await itemsModel.find({ operationId }).sort({ curationId: 1, _id: 1 }).lean() as Record<string, unknown>[]
    const evidence = evidenceFor(rows)
    let archive = existingArchive(operation)
    let purgeStarted = Boolean(archive && dateValue(archive.purgeStartedAt))

    if (!archive) {
      const itemArchive = {
        ...evidence,
        compactedAt: now.toISOString(),
        sourceUpdatedAt: updatedAt.toISOString(),
        purgeStartedAt: now.toISOString(),
      }
      const persisted = await operations.updateOne(
        {
          _id: operation.id ?? operation._id,
          status,
          updatedAt,
          itemArchive: { $exists: false },
        },
        { $set: { itemArchive } },
      )
      if (Number(persisted.modifiedCount ?? 0) !== 1) {
        preservedOperations += 1
        continue
      }
      archive = itemArchive
      purgeStarted = true
    } else if (!purgeStarted) {
      if (rows.length > 0 && !archiveMatches(archive, evidence)) {
        // No destructive phase was ever recorded, so a mismatch here is not a
        // legitimate partial purge. Preserve the detail for operator review.
        preservedOperations += 1
        continue
      }
      const started = await markPurgeStarted(operations, operation, String(archive.sha256), now)
      if (!started) {
        preservedOperations += 1
        continue
      }
      archive = { ...archive, purgeStartedAt: now.toISOString() }
      purgeStarted = true
    }

    if (!purgeStarted) {
      preservedOperations += 1
      continue
    }

    try {
      if (rows.length > 0) {
        const deletion = await itemsModel.deleteMany({ operationId })
        const removed = Number(deletion.deletedCount ?? 0)
        if (removed !== rows.length) {
          // A partial delete is safe but incomplete. `purgeStartedAt` keeps the
          // parent retryable; the next run deletes the remaining subset.
          deletedItems += removed
          preservedOperations += 1
          continue
        }
        deletedItems += removed
      }

      const archivedItemCount = Number(archive.itemCount)
      const purgedItemCount = Number.isInteger(archivedItemCount) && archivedItemCount >= 0
        ? archivedItemCount
        : rows.length
      const marked = await markItemsPurged(operations, operation, String(archive.sha256), now, purgedItemCount)
      if (!marked) {
        // Rows may already be gone, but leaving the completion marker absent is
        // safe: the next run can finish the CAS from the durable summary.
        preservedOperations += 1
        continue
      }
      compactedOperations += 1
    } catch {
      // Summary + purgeStartedAt stay durable and keep this operation eligible
      // for a later retry, including interruption after a partial delete.
      preservedOperations += 1
    }
  }

  return {
    scannedOperations: candidates.length,
    compactedOperations,
    deletedItems,
    preservedOperations,
  }
}
