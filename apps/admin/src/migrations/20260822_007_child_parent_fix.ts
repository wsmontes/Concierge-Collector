import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

/**
 * Fixes the unique partial indexes that collide on parent operations.
 *
 * Parents persist an explicit `parentOperationId: null` and no `jobId`, so:
 *   - `operation_job_unique` (from 002) is a FULL unique index on `jobId` —
 *     every parent indexes `{ jobId: null }` and the second parent E11000s;
 *   - `child_parent_unique` (from 006) filtered by `{ parentOperationId: { $exists: true } }`
 *     — `$exists: true` also matches the explicit `null` on parents, so every
 *     parent indexes `(null, <missing>)` and the second parent E11000s.
 *
 * Both indexes are recreated with a `$type: 'string'` partial filter, which
 * excludes parents (null / missing) while keeping children (string jobId and
 * string parentOperationId) unique.
 */
const fixedIndexes = [
  [
    'collection-operations',
    { jobId: 1 },
    { name: 'operation_job_unique', unique: true, partialFilterExpression: { jobId: { $type: 'string' } } },
  ],
  [
    'collection-operations',
    { parentOperationId: 1, collectionId: 1 },
    { name: 'child_parent_unique', unique: true, partialFilterExpression: { parentOperationId: { $type: 'string' } } },
  ],
] as const

const originalIndexes = [
  ['collection-operations', { jobId: 1 }, { name: 'operation_job_unique', unique: true }],
  [
    'collection-operations',
    { parentOperationId: 1, collectionId: 1 },
    { name: 'child_parent_unique', unique: true, partialFilterExpression: { parentOperationId: { $exists: true } } },
  ],
] as const

export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') throw new Error('Parent operation index fix requires the MongoDB adapter')
  for (const [slug, fields, options] of fixedIndexes) {
    const model = adapter.collections[slug]
    if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
    try {
      await model.collection.dropIndex(options.name)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('index not found')) throw error
    }
    await model.collection.createIndex(fields, options)
  }
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') return
  for (const [slug, fields, options] of originalIndexes) {
    const model = adapter.collections[slug]
    if (!model) continue
    try {
      await model.collection.dropIndex(options.name)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('index not found')) throw error
    }
    await model.collection.createIndex(fields, options)
  }
}
