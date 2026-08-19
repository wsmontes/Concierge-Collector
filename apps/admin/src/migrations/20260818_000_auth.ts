import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const indexes = [
  ['cms-login-states', { stateHash: 1 }, { name: 'cms_login_state_hash_unique', unique: true }],
  ['cms-login-states', { expiresAt: 1 }, { expireAfterSeconds: 0, name: 'cms_login_state_expiry_ttl' }],
  ['cms-sessions', { sessionHash: 1 }, { name: 'cms_session_hash_unique', unique: true }],
  ['cms-sessions', { expiresAt: 1 }, { expireAfterSeconds: 0, name: 'cms_session_expiry_ttl' }],
] as const

export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') throw new Error('CMS auth migration requires the MongoDB adapter')

  for (const [slug, fields, options] of indexes) {
    const model = adapter.collections[slug]
    if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
    // MongoDB DDL must not run inside the transaction used by Payload's
    // migration ledger. createIndex is idempotent with the named spec.
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
