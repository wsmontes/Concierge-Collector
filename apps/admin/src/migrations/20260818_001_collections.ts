import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const indexes = [
  ['collections', { slug: 1 }, { name: 'collections_slug_unique', unique: true }],
  ['collection-versions', { collectionId: 1, version: 1 }, { name: 'collection_version_unique', unique: true }],
  ['collection-versions', { collectionId: 1, status: 1, version: -1 }, { name: 'collection_versions_by_status' }],
  [
    'collection-memberships',
    { collectionId: 1, addedInVersion: 1, removedInVersion: 1, curationId: 1 },
    { name: 'membership_for_version' },
  ],
  [
    'collection-memberships',
    { collectionId: 1, curationId: 1, addedInVersion: 1 },
    { name: 'membership_interval_unique', unique: true },
  ],
  [
    'collection-memberships',
    { collectionId: 1, curationId: 1 },
    {
      name: 'membership_open_unique',
      unique: true,
      partialFilterExpression: { removedInVersion: null },
    },
  ],
  [
    'collection-memberships',
    { curationId: 1, collectionId: 1, removedInVersion: 1 },
    { name: 'membership_by_curation' },
  ],
  [
    'collection-draft-changes',
    { operationId: 1, curationId: 1 },
    { name: 'draft_change_item_unique', unique: true },
  ],
  [
    'collection-draft-changes',
    { collectionId: 1, draftEpoch: 1, targetDraftRevision: 1, desiredState: 1, curationId: 1 },
    { name: 'draft_changes_visible' },
  ],
  [
    'collection-operations',
    { collectionId: 1, idempotencyKey: 1 },
    { name: 'operation_idempotency_unique', unique: true },
  ],
  [
    'collection-operations',
    { collectionId: 1, operationSequence: 1, status: 1 },
    { name: 'operation_queue_order' },
  ],
  ['collection-operations', { status: 1, leaseExpiresAt: 1 }, { name: 'operation_lease_expiry' }],
  [
    'collection-operation-items',
    { operationId: 1, curationId: 1 },
    { name: 'operation_item_unique', unique: true },
  ],
  ['collection-operation-items', { operationId: 1, status: 1, curationId: 1 }, { name: 'operation_items_by_status' }],
  [
    'collection-publish-jobs',
    { collectionId: 1, status: 1, createdAt: 1 },
    { name: 'publish_queue_order' },
  ],
  ['collection-publish-jobs', { status: 1, leaseExpiresAt: 1 }, { name: 'publish_lease_expiry' }],
  ['audit-events', { eventKey: 1 }, { name: 'audit_event_key_unique', unique: true }],
  ['audit-events', { collectionId: 1, createdAt: -1 }, { name: 'audit_by_collection' }],
  ['audit-events', { actorId: 1, createdAt: -1 }, { name: 'audit_by_actor' }],
] as const

export async function up({ payload, session }: MigrateUpArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') throw new Error('Collections migration requires the MongoDB adapter')

  for (const [slug, fields, options] of indexes) {
    const model = adapter.collections[slug]
    if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
    await model.collection.createIndex(fields, { ...options, session })
  }
}

export async function down({ payload, session }: MigrateDownArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') return

  for (const [slug, , options] of indexes) {
    const model = adapter.collections[slug]
    if (model) await model.collection.dropIndex(options.name, { session })
  }
}
