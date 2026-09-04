import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const INDEX = 'worker_heartbeat_ttl'
const RETENTION_SECONDS = 7 * 24 * 60 * 60

async function dropIfPresent(collection: { dropIndex(name: string): Promise<unknown> }): Promise<void> {
  try {
    await collection.dropIndex(INDEX)
  } catch (error) {
    const value = error as { code?: unknown; codeName?: unknown }
    if (value?.code === 27 || value?.codeName === 'IndexNotFound') return
    throw error
  }
}

/** Worker heartbeat rows are disposable liveness telemetry, not audit evidence. */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') throw new Error('Worker heartbeat retention requires the MongoDB adapter')
  const model = payload.db.collections['worker-heartbeats']
  if (!model) throw new Error('Missing CMS collection model: worker-heartbeats')
  await model.collection.createIndex(
    { observedAt: 1 },
    { name: INDEX, expireAfterSeconds: RETENTION_SECONDS },
  )
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') return
  const model = payload.db.collections['worker-heartbeats']
  if (!model) return
  await dropIfPresent(model.collection)
}
