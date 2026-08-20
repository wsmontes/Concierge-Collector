import type { CollectionConfig } from 'payload'

export const CollectionDraftChanges: CollectionConfig = {
  slug: 'collection-draft-changes',
  dbName: 'collection_draft_changes',
  admin: { hidden: true },
  access: { create: () => false, read: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'collectionId', type: 'text', required: true, index: true },
    { name: 'curationId', type: 'text', required: true, index: true },
    { name: 'desiredState', type: 'select', required: true, options: ['add', 'remove'], index: true },
    { name: 'basePublishedVersion', type: 'number' },
    { name: 'draftEpoch', type: 'text', required: true, index: true },
    { name: 'baseDraftRevision', type: 'number', required: true },
    { name: 'targetDraftRevision', type: 'number', required: true, index: true },
    { name: 'operationId', type: 'text', required: true, index: true },
    { name: 'operationSequence', type: 'number', required: true },
    // A worker may prepare rows long before the collection revision advances.
    // Only the commit transaction promotes them to `committed`.
    { name: 'stageState', type: 'select', required: true, options: ['staged', 'committed'], defaultValue: 'staged', index: true },
    { name: 'validUntilDraftRevision', type: 'number' },
  ],
}
