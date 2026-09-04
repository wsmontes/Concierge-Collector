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

/**
 * Bounds the high-cardinality per-item operation table without losing the
 * evidence needed to verify an old operation. Only terminal parents older than
 * the retention window are eligible. A deterministic digest/count summary is
 * persisted on the parent under CAS before any item row is deleted.
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
    itemArchive: { $exists: false },
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
    const digest = createHash('sha256')
    const statusCounts: Record<string, number> = {}
    const reasonCounts: Record<string, number> = {}
    for (const row of rows) {
      digest.update(`${canonicalLine(row)}\n`)
      increment(statusCounts, typeof row.status === 'string' ? row.status : null)
      increment(reasonCounts, typeof row.reasonCode === 'string' ? row.reasonCode : null)
    }

    const itemArchive = {
      itemCount: rows.length,
      statusCounts,
      reasonCounts,
      sha256: digest.digest('hex'),
      compactedAt: now.toISOString(),
      sourceUpdatedAt: updatedAt.toISOString(),
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

    const deletion = await itemsModel.deleteMany({ operationId })
    compactedOperations += 1
    deletedItems += Number(deletion.deletedCount ?? 0)
  }

  return {
    scannedOperations: candidates.length,
    compactedOperations,
    deletedItems,
    preservedOperations,
  }
}
