import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const INDEX = 'operation_retention_scan'

export async function up({ payload }: MigrateUpArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') throw new Error('Operation item retention requires the MongoDB adapter')
  const model = payload.db.collections['collection-operations']
  if (!model) throw new Error('Missing CMS collection model: collection-operations')
  await model.collection.createIndex({ status: 1, updatedAt: 1 }, { name: INDEX })
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') return
  const model = payload.db.collections['collection-operations']
  if (!model) return
  try {
    await model.collection.dropIndex(INDEX)
  } catch (error) {
    const value = error as { code?: unknown; codeName?: unknown }
    if (value?.code === 27 || value?.codeName === 'IndexNotFound') return
    throw error
  }
}
