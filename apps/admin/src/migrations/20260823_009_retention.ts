import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const HEARTBEAT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

async function dropIfPresent(model: { collection: { dropIndex(name: string): Promise<unknown> } }, name: string): Promise<void> {
  try {
    await model.collection.dropIndex(name)
  } catch (error) {
    const codeName = typeof error === 'object' && error !== null ? (error as { codeName?: unknown }).codeName : undefined
    if (codeName !== 'IndexNotFound') throw error
  }
}

export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') throw new Error('Retention migration requires the MongoDB adapter')

  const exportsModel = adapter.collections['collection-exports']
  const heartbeats = adapter.collections['worker-heartbeats']
  const archives = adapter.collections['retention-archive-manifests']
  if (!exportsModel || !heartbeats || !archives) throw new Error('Missing CMS collection model for retention migration')

  // Migration 008 used a Mongo TTL on export records. That could erase the
  // only object key before the worker deleted the private artifact. Replace it
  // with a normal scan index; the maintenance task now deletes object first
  // and leaves a `purged` tombstone.
  await dropIfPresent(exportsModel, 'export_artifact_ttl')
  await exportsModel.collection.createIndex(
    { expiresAt: 1, status: 1 },
    { name: 'export_expiry_scan' },
  )

  // Existing heartbeat rows predate expiresAt. Backfill once, then let the
  // zero-second TTL use per-document expiry instants.
  const existing = await heartbeats.find({ expiresAt: { $exists: false } }).select({ _id: 1, observedAt: 1 }).lean()
  for (const row of existing) {
    const observedAt = new Date(String((row as Record<string, unknown>).observedAt))
    const base = Number.isFinite(observedAt.getTime()) ? observedAt.getTime() : Date.now()
    await heartbeats.updateOne(
      { _id: (row as Record<string, unknown>)._id, expiresAt: { $exists: false } },
      { $set: { expiresAt: new Date(base + HEARTBEAT_RETENTION_MS) } },
    )
  }
  await heartbeats.collection.createIndex(
    { expiresAt: 1 },
    { name: 'worker_heartbeat_expiry_ttl', expireAfterSeconds: 0 },
  )

  await archives.collection.createIndex(
    { archiveKey: 1 },
    { name: 'retention_archive_key_unique', unique: true },
  )
  await archives.collection.createIndex(
    { kind: 1, archivedAt: 1 },
    { name: 'retention_archive_history' },
  )
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') return

  const exportsModel = adapter.collections['collection-exports']
  const heartbeats = adapter.collections['worker-heartbeats']
  const archives = adapter.collections['retention-archive-manifests']
  if (exportsModel) {
    await dropIfPresent(exportsModel, 'export_expiry_scan')
    await exportsModel.collection.createIndex(
      { expiresAt: 1 },
      { name: 'export_artifact_ttl', expireAfterSeconds: 0 },
    )
  }
  if (heartbeats) await dropIfPresent(heartbeats, 'worker_heartbeat_expiry_ttl')
  if (archives) {
    await dropIfPresent(archives, 'retention_archive_key_unique')
    await dropIfPresent(archives, 'retention_archive_history')
  }
}
