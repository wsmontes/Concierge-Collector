import type { CollectionConfig } from 'payload'

export const CollectionPublishJobs: CollectionConfig = {
  slug: 'collection-publish-jobs',
  dbName: 'collection_publish_jobs',
  admin: { hidden: true },
  access: { create: () => false, read: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'collectionId', type: 'text', required: true, index: true },
    { name: 'fixedDraftEpoch', type: 'text', required: true },
    { name: 'fixedDraftRevision', type: 'number', required: true },
    { name: 'baseVersion', type: 'number' },
    { name: 'targetVersion', type: 'number', required: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: ['queued', 'running', 'committing', 'completed', 'failed', 'cancelled', 'stale'],
      index: true,
    },
    {
      name: 'checkpoint',
      type: 'select',
      options: ['locked', 'intervals_applied', 'version_ready', 'validated', 'promoted'],
    },
    { name: 'selectedCount', type: 'number' },
    { name: 'membershipHash', type: 'text' },
    { name: 'leaseOwner', type: 'text' },
    { name: 'leaseExpiresAt', type: 'date', index: true },
    { name: 'fencingToken', type: 'number', required: true, defaultValue: 0 },
    { name: 'actorId', type: 'text', required: true },
  ],
}
