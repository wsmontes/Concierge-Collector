import type { CollectionConfig } from 'payload'

/** Immutable proof that a retention batch was uploaded before source purge. */
export const RetentionArchiveManifests: CollectionConfig = {
  slug: 'retention-archive-manifests',
  dbName: 'retention_archive_manifests',
  admin: { hidden: true },
  access: { create: () => false, read: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'archiveKey', type: 'text', required: true, unique: true },
    { name: 'kind', type: 'select', required: true, options: ['audit_events', 'operation_items'], index: true },
    { name: 'sourceCollection', type: 'text', required: true },
    { name: 'objectKey', type: 'text', required: true },
    { name: 'sha256', type: 'text', required: true },
    { name: 'count', type: 'number', required: true },
    { name: 'oldestCreatedAt', type: 'date' },
    { name: 'newestCreatedAt', type: 'date' },
    { name: 'archivedAt', type: 'date', required: true, index: true },
  ],
}
