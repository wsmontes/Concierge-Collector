import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const indexes = [
  ['consumer-applications', { name: 1 }, { name: 'consumer_application_name_unique', unique: true }],
  ['consumer-credentials', { applicationId: 1, prefix: 1 }, { name: 'consumer_credential_prefix_unique', unique: true }],
  ['consumer-credentials', { applicationId: 1, issueIdempotencyKey: 1 }, { name: 'consumer_credential_issue_idempotency_unique', unique: true }],
  ['consumer-credentials', { prefix: 1, secretHash: 1, status: 1, expiresAt: 1 }, { name: 'consumer_credential_auth_lookup' }],
  ['audit-events', { credentialId: 1, createdAt: -1 }, { name: 'audit_by_credential', sparse: true }],
  ['audit-events', { applicationId: 1, createdAt: -1 }, { name: 'audit_by_application', sparse: true }],
] as const

export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') throw new Error('Consumer migration requires the MongoDB adapter')
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
