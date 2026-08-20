import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const indexes = [
  // Idempotent POST by (actor, idempotency key), mirroring selection manifests.
  ['collection-exports', { actorId: 1, idempotencyKey: 1 }, { name: 'export_idempotency_unique', unique: true }],
  // Claim/query path used by the worker and the exports list.
  ['collection-exports', { selectionId: 1, status: 1 }, { name: 'export_selection_status' }],
  // Artifact references are bounded by the record TTL; the value on the
  // document is the expiry instant (expireAfterSeconds: 0).
  ['collection-exports', { expiresAt: 1 }, { name: 'export_artifact_ttl', expireAfterSeconds: 0 }],
] as const

export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') throw new Error('Selection exports require the MongoDB adapter')
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
