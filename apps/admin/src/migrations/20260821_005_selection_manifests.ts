import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const indexes = [
  ['selection-manifests', { actorId: 1, idempotencyKey: 1 }, { name: 'selection_idempotency_unique', unique: true }],
  ['selection-manifests', { status: 1, leaseExpiresAt: 1 }, { name: 'selection_lease_expiry' }],
  ['selection-manifests', { expiresAt: 1 }, { name: 'selection_manifest_ttl', expireAfterSeconds: 0 }],
  ['selection-manifest-items', { selectionId: 1, curationId: 1 }, { name: 'selection_item_unique', unique: true }],
  ['selection-manifest-items', { expiresAt: 1 }, { name: 'selection_item_ttl', expireAfterSeconds: 0 }],
] as const

export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') throw new Error('Selection manifests require the MongoDB adapter')
  for (const [slug, fields, options] of indexes) {
    const model = adapter.collections[slug]
    if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
    await model.collection.createIndex(fields, options)
  }
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') return
  for (const [slug, , options] of indexes) {
    const model = adapter.collections[slug]
    if (model) await model.collection.dropIndex(options.name)
  }
}
