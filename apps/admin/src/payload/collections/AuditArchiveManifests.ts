import type { CollectionConfig } from 'payload'

/**
 * Durable evidence that a hot audit batch was exported to private object
 * storage before its source rows were removed. Operational only; never exposed
 * through the Admin UI or consumer distribution API.
 */
export const AuditArchiveManifests: CollectionConfig = {
  slug: 'audit-archive-manifests',
  dbName: 'audit_archive_manifests',
  admin: { hidden: true },
  access: { create: () => false, read: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'batchKey', type: 'text', required: true, unique: true },
    { name: 'artifactKey', type: 'text', required: true },
    { name: 'contentType', type: 'text', required: true },
    { name: 'sha256', type: 'text', required: true },
    { name: 'eventCount', type: 'number', required: true },
    { name: 'firstEventId', type: 'text', required: true },
    { name: 'lastEventId', type: 'text', required: true },
    { name: 'oldestCreatedAt', type: 'date', required: true },
    { name: 'newestCreatedAt', type: 'date', required: true },
    { name: 'archivedAt', type: 'date', required: true },
  ],
}
