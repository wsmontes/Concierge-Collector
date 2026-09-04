import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const AUDIT_SCAN = 'audit_archive_scan'
const MANIFEST_UNIQUE = 'audit_archive_batch_unique'

async function dropIfPresent(collection: { dropIndex(name: string): Promise<unknown> }, name: string): Promise<void> {
  try {
    await collection.dropIndex(name)
  } catch (error) {
    const value = error as { code?: unknown; codeName?: unknown }
    if (value?.code === 27 || value?.codeName === 'IndexNotFound') return
    throw error
  }
}

export async function up({ payload }: MigrateUpArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') throw new Error('Audit archival requires the MongoDB adapter')
  const events = payload.db.collections['audit-events']
  const manifests = payload.db.collections['audit-archive-manifests']
  if (!events || !manifests) throw new Error('Missing audit archival CMS models')
  await events.collection.createIndex({ createdAt: 1, _id: 1 }, { name: AUDIT_SCAN })
  await manifests.collection.createIndex({ batchKey: 1 }, { name: MANIFEST_UNIQUE, unique: true })
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') return
  const events = payload.db.collections['audit-events']
  const manifests = payload.db.collections['audit-archive-manifests']
  if (events) await dropIfPresent(events.collection, AUDIT_SCAN)
  if (manifests) await dropIfPresent(manifests.collection, MANIFEST_UNIQUE)
}
