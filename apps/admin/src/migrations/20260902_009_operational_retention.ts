import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const INDEX_NAME = 'worker_heartbeat_ttl'
const HEARTBEAT_RETENTION_SECONDS = 7 * 24 * 60 * 60

/**
 * Operational-only TTL. Product/domain records (Collections, versions,
 * memberships, applications, credentials and audits) deliberately receive no
 * TTL here. Selection/export TTLs already live in their owning migrations.
 */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') throw new Error('Operational retention requires the MongoDB adapter')
  const model = adapter.collections['worker-heartbeats']
  if (!model) throw new Error('Missing CMS collection model: worker-heartbeats')
  await model.collection.createIndex(
    { observedAt: 1 },
    { name: INDEX_NAME, expireAfterSeconds: HEARTBEAT_RETENTION_SECONDS },
  )
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') return
  const model = adapter.collections['worker-heartbeats']
  if (model) await model.collection.dropIndex(INDEX_NAME)
}
