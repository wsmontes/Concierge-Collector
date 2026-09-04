import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const INDEX = 'operation_retention_due'

async function dropIfPresent(collection: { dropIndex(name: string): Promise<unknown> }): Promise<void> {
  try {
    await collection.dropIndex(INDEX)
  } catch (error) {
    const value = error as { code?: unknown; codeName?: unknown }
    if (value?.code === 27 || value?.codeName === 'IndexNotFound') return
    throw error
  }
}

/**
 * Keeps quarantined evidence contradictions out of the age-ordered retention
 * scan without requiring the worker to walk an ever-growing blocked prefix.
 */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') throw new Error('Operation retention quarantine requires the MongoDB adapter')
  const model = payload.db.collections['collection-operations']
  if (!model) throw new Error('Missing CMS collection model: collection-operations')
  await model.collection.createIndex(
    {
      status: 1,
      'itemArchive.itemsPurgedAt': 1,
      'itemArchive.retentionBlockedAt': 1,
      updatedAt: 1,
      _id: 1,
    },
    { name: INDEX },
  )
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') return
  const model = payload.db.collections['collection-operations']
  if (!model) return
  await dropIfPresent(model.collection)
}
