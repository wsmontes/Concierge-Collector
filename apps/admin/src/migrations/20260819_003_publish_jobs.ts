import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const indexes = [
  ['collection-publish-jobs', { collectionId: 1, idempotencyKey: 1 }, { name: 'publish_idempotency_unique', unique: true }],
  ['collection-publish-jobs', { payloadJobId: 1 }, { name: 'publish_payload_job_unique', unique: true }],
] as const

export async function up({ payload, session }: MigrateUpArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') throw new Error('Publish migration requires the MongoDB adapter')
  const collections = adapter.collections.collections
  if (!collections) throw new Error('Missing CMS collection model: collections')
  await collections.updateMany(
    { publishFencingToken: { $exists: false } },
    { $set: { publishFencingToken: 0 } },
    { session },
  )
  for (const [slug, fields, options] of indexes) {
    const model = adapter.collections[slug]
    if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
    await model.collection.createIndex(fields, options)
  }
}

export async function down({ payload, session }: MigrateDownArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') return
  for (const [slug, , options] of indexes) {
    const model = adapter.collections[slug]
    if (model) await model.collection.dropIndex(options.name)
  }
}
