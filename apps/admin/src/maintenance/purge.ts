import { Types, type ClientSession, type Model } from 'mongoose'
import type { Payload } from 'payload'
import type { ArtifactStore } from '../storage/artifact-store'
import { createS3ArtifactStore } from '../storage/s3-artifact-store'
import { archiveBatch, type ArchiveManifest } from './archive'
import { purgeOrphanStages } from './reconciliation'
import { cutoff, readRetentionPolicy } from './retention'

type DocumentModel = Model<Record<string, unknown>>
const TERMINAL_OPERATION_STATES = [
  'committed',
  'completed',
  'completed_with_skips',
  'failed',
  'cancelled',
  'stale',
  'conflicted',
  'authorization_revoked',
]

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
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

function bytesBody(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () { yield bytes })()
}

async function archiveModelBatch(
  payload: Payload,
  input: {
    sourceSlug: string
    kind: ArchiveManifest['kind']
    query: Record<string, unknown>
    now: Date
    limit?: number
    store?: ArtifactStore
  },
): Promise<ArchiveManifest | null> {
  const source = modelFor(payload, input.sourceSlug)
  const docs = await source.find(input.query).sort({ createdAt: 1, _id: 1 }).limit(input.limit ?? 1000).lean() as Record<string, unknown>[]
  if (!docs.length) return null
  const store = input.store ?? createS3ArtifactStore()

  return archiveBatch({
    kind: input.kind,
    sourceCollection: input.sourceSlug,
    docs,
    now: input.now,
    put: async ({ key, bytes, contentType }) => {
      // Retention archives are long-lived private evidence. The artifact store
      // requires an expiry metadata field for export compatibility, but no CMS
      // TTL consumes this date and the maintenance bucket lifecycle must not
      // delete the retention/ prefix.
      const stored = await store.put({
        key,
        contentType,
        expiresAt: new Date('9999-12-31T23:59:59.999Z'),
        body: bytesBody(bytes),
      })
      return { key: stored.key, sha256: stored.sha256 }
    },
    persistManifestAndDelete: async ({ manifest, ids }) => {
      await inTransaction(payload, async (session) => {
        const manifests = modelFor(payload, 'retention-archive-manifests')
        const existing = await manifests.findOne({ archiveKey: manifest.archiveKey }).session(session).lean()
        if (!existing) {
          await manifests.create([{
            _id: new Types.ObjectId().toHexString(),
            ...manifest,
            oldestCreatedAt: manifest.oldestCreatedAt ? new Date(manifest.oldestCreatedAt) : null,
            newestCreatedAt: manifest.newestCreatedAt ? new Date(manifest.newestCreatedAt) : null,
            archivedAt: new Date(manifest.archivedAt),
            createdAt: input.now,
            updatedAt: input.now,
          }], { session })
        }
        await source.deleteMany({ _id: { $in: ids } }, { session })
      })
    },
  })
}

export async function archiveExpiredAuditEvents(
  payload: Payload,
  now: Date = new Date(),
  store?: ArtifactStore,
): Promise<ArchiveManifest | null> {
  const policy = readRetentionPolicy()
  return archiveModelBatch(payload, {
    sourceSlug: 'audit-events',
    kind: 'audit_events',
    query: { createdAt: { $lt: cutoff(now, policy.auditRetentionDays, 'days') } },
    now,
    store,
  })
}

export async function archiveTerminalOperationItems(
  payload: Payload,
  now: Date = new Date(),
  store?: ArtifactStore,
): Promise<ArchiveManifest | null> {
  const policy = readRetentionPolicy()
  const operations = modelFor(payload, 'collection-operations')
  const oldOperations = await operations.find({
    status: { $in: TERMINAL_OPERATION_STATES },
    updatedAt: { $lt: cutoff(now, policy.operationItemRetentionDays, 'days') },
    // Parent operations do not own item rows.
    parentOperationId: { $ne: null },
  }).select({ _id: 1 }).sort({ updatedAt: 1, _id: 1 }).limit(250).lean() as Record<string, unknown>[]
  const operationIds = oldOperations.map((operation) => String(operation._id))
  if (!operationIds.length) return null
  return archiveModelBatch(payload, {
    sourceSlug: 'collection-operation-items',
    kind: 'operation_items',
    query: { operationId: { $in: operationIds } },
    now,
    store,
  })
}

/**
 * Delete an expired private export object first, then retain a purged CMS
 * tombstone. A failed object delete leaves the record untouched for retry.
 */
export async function purgeExpiredExports(
  payload: Payload,
  now: Date = new Date(),
  store?: ArtifactStore,
): Promise<number> {
  const exportsModel = modelFor(payload, 'collection-exports')
  const expired = await exportsModel.find({
    expiresAt: { $lte: now },
    status: { $in: ['complete', 'failed'] },
  }).sort({ expiresAt: 1, _id: 1 }).limit(250).lean() as Record<string, unknown>[]
  if (!expired.length) return 0

  let purged = 0
  let artifactStore = store
  for (const record of expired) {
    const key = typeof record.key === 'string' ? record.key : ''
    if (key) {
      artifactStore ??= createS3ArtifactStore()
      await artifactStore.delete(key)
    }
    const result = await exportsModel.updateOne(
      { _id: record._id, status: record.status, expiresAt: record.expiresAt },
      {
        $set: {
          status: 'purged',
          purgedAt: now,
          key: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        },
      },
    )
    purged += result.modifiedCount
  }
  return purged
}

export interface PurgeResult {
  exportsPurged: number
  orphanStagesPurged: number
  operationItemsArchived: number
}

export async function purgeExpiredArtifacts(
  payload: Payload,
  now: Date = new Date(),
  store?: ArtifactStore,
): Promise<PurgeResult> {
  const archive = await archiveTerminalOperationItems(payload, now, store)
  return {
    exportsPurged: await purgeExpiredExports(payload, now, store),
    orphanStagesPurged: await purgeOrphanStages(payload, now),
    operationItemsArchived: archive?.count ?? 0,
  }
}
