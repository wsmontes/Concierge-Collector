import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const INDEX = 'staging_retention_scan'

async function dropIfPresent(collection: { dropIndex(name: string): Promise<unknown> }): Promise<void> {
  try {
    await collection.dropIndex(INDEX)
  } catch (error) {
    const value = error as { code?: unknown; codeName?: unknown }
    if (value?.code === 27 || value?.codeName === 'IndexNotFound') return
    throw error
  }
}

/** Supports the age-ordered pre-lookup scan used by orphan staging retention. */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') throw new Error('Staging retention scan requires the MongoDB adapter')
  const model = payload.db.collections['collection-draft-changes']
  if (!model) throw new Error('Missing CMS collection model: collection-draft-changes')
  await model.collection.createIndex(
    { stageState: 1, updatedAt: 1, _id: 1 },
    { name: INDEX },
  )
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') return
  const model = payload.db.collections['collection-draft-changes']
  if (!model) return
  await dropIfPresent(model.collection)
}
