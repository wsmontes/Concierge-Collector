import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const INDEX = 'export_cleanup_due'

async function dropIfPresent(collection: { dropIndex(name: string): Promise<unknown> }): Promise<void> {
  try {
    await collection.dropIndex(INDEX)
  } catch (error) {
    const value = error as { code?: unknown; codeName?: unknown }
    if (value?.code === 27 || value?.codeName === 'IndexNotFound') return
    throw error
  }
}

/** Supports terminal + backoff-due + expiry-ordered object-first cleanup. */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') throw new Error('Export cleanup backoff requires the MongoDB adapter')
  const model = payload.db.collections['collection-exports']
  if (!model) throw new Error('Missing CMS collection model: collection-exports')
  await model.collection.createIndex(
    { status: 1, cleanupNextAttemptAt: 1, expiresAt: 1, _id: 1 },
    { name: INDEX },
  )
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') return
  const model = payload.db.collections['collection-exports']
  if (!model) return
  await dropIfPresent(model.collection)
}
