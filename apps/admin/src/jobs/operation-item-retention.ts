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
const SUCCESS_TERMINAL_STATUSES = ['committed', 'completed', 'completed_with_skips'] as const
const TERMINAL_OPERATION_STATUS_SET = new Set<string>(TERMINAL_OPERATION_STATUSES)
const SUCCESS_TERMINAL_STATUS_SET = new Set<string>(SUCCESS_TERMINAL_STATUSES)

const DEFAULT_RETENTION_DAYS = 90
const DEFAULT_BATCH_SIZE = 100
const DETAIL_CURSOR_BATCH_SIZE = 1_000

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

function asRow(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && 'toObject' in value && typeof (value as { toObject?: unknown }).toObject === 'function') {
    return (value as { toObject(): Record<string, unknown> }).toObject()
  }
  return value as Record<string, unknown>
}

/**
 * Computes immutable detail evidence through a bounded Mongo cursor. A single
 * bulk operation may own hundreds of thousands of rows; the worker must never
 * materialize all of them just to calculate the archival digest.
 */
async function evidenceForOperation(items: DocumentModel, operationId: string) {
  const digest = createHash('sha256')
  const statusCounts: Record<string, number> = {}
  const reasonCounts: Record<string, number> = {}
  let itemCount = 0
  const cursor = items.find({ operationId })
    .sort({ curationId: 1, _id: 1 })
    .batchSize(DETAIL_CURSOR_BATCH_SIZE)
    .cursor()

  for await (const value of cursor) {
    const row = asRow(value)
    digest.update(`${canonicalLine(row)}\n`)
    increment(statusCounts, typeof row.status === 'string' ? row.status : null)
    increment(reasonCounts, typeof row.reasonCode === 'string' ? row.reasonCode : null)
    itemCount += 1
  }

  return {
    itemCount,
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

function archiveMatches(archive: Record<string, unknown>, evidence: Awaited<ReturnType<typeof evidenceForOperation>>): boolean {
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
 * evidence needed to verify an old operation. Only terminal child/single
 * operations older than the retention window are eligible; aggregate parent
 * operations never own item rows and are excluded at the scan boundary.
 *
 * Before the destructive phase, raw detail is streamed in canonical order to a
 * SHA/count summary. Successful operations must have `selectedCount` equal to
 * that intact item count; otherwise retention preserves the rows for operator
 * review. Failed/cancelled materialization may legitimately stop with partial
 * item detail. A cursor/read failure preserves only that operation and does not
 * prevent later candidates in the same bounded batch from being maintained.
 *
 * `purgeStartedAt` is durable before deletion. Once present, retries never
 * rehash a partial subset: they delete whatever remains for the same
 * operationId, verify the detail collection is empty, and finish
 * `itemsPurgedAt` from the immutable pre-delete summary.
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
    collectionId: { $exists: true, $ne: null },
    jobId: { $exists: true, $ne: null },
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
    if (!operationId || !updatedAt || !TERMINAL_OPERATION_STATUS_SET.has(status)) {
      preservedOperations += 1
      continue
    }

    let archive = existingArchive(operation)
    let purgeStarted = Boolean(archive && dateValue(archive.purgeStartedAt))

    if (!purgeStarted) {
      let evidence: Awaited<ReturnType<typeof evidenceForOperation>>
      try {
        evidence = await evidenceForOperation(itemsModel, operationId)
      } catch {
        preservedOperations += 1
        continue
      }

      const successful = SUCCESS_TERMINAL_STATUS_SET.has(status)
      const selectedCount = Number(operation.selectedCount)
      if (
        successful &&
        (!Number.isInteger(selectedCount) || selectedCount < 0 || evidence.itemCount !== selectedCount)
      ) {
        preservedOperations += 1
        continue
      }

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
      } else {
        if (!archiveMatches(archive, evidence)) {
          // No destructive phase was ever recorded, so a mismatch here cannot
          // be a legitimate partial purge.
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
    }

    if (!archive || !purgeStarted) {
      preservedOperations += 1
      continue
    }

    try {
      const deletion = await itemsModel.deleteMany({ operationId })
      const removed = Number(deletion.deletedCount ?? 0)
      deletedItems += removed

      const remaining = await itemsModel.countDocuments({ operationId })
      if (remaining !== 0) {
        // Partial delete is an expected retry state after purgeStartedAt.
        preservedOperations += 1
        continue
      }

      const archivedItemCount = Number(archive.itemCount)
      if (!Number.isInteger(archivedItemCount) || archivedItemCount < 0) {
        preservedOperations += 1
        continue
      }
      const marked = await markItemsPurged(operations, operation, String(archive.sha256), now, archivedItemCount)
      if (!marked) {
        // Detail may already be gone; absence of the completion marker keeps
        // the operation eligible for a later CAS-only retry.
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
