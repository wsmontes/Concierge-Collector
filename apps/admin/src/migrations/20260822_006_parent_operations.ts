import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

// Parents persist an explicit `parentOperationId: null` (never a missing field)
// so both partial filters stay within the operators MongoDB supports — a
// parent is `{ parentOperationId: null }` and a child `{ $exists: true }`.
const indexes = [
  [
    'collection-operations',
    { actorId: 1, idempotencyKey: 1 },
    { name: 'parent_idempotency_unique', unique: true, partialFilterExpression: { parentOperationId: null } },
  ],
  [
    'collection-operations',
    { parentOperationId: 1, collectionId: 1 },
    { name: 'child_parent_unique', unique: true, partialFilterExpression: { parentOperationId: { $exists: true } } },
  ],
  ['collection-operations', { actorId: 1, parentOperationId: 1, status: 1 }, { name: 'parent_actor_active' }],
] as const

export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') throw new Error('Parent operations require the MongoDB adapter')
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
