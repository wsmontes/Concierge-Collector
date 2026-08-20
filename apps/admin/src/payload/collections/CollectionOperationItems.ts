import type { CollectionConfig } from 'payload'

export const CollectionOperationItems: CollectionConfig = {
  slug: 'collection-operation-items',
  dbName: 'collection_operation_items',
  admin: { hidden: true },
  access: { create: () => false, read: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'operationId', type: 'text', required: true, index: true },
    { name: 'curationId', type: 'text', required: true, index: true },
    { name: 'desiredState', type: 'select', required: true, options: ['add', 'remove'] },
    { name: 'status', type: 'select', required: true, options: ['pending', 'applied', 'skipped', 'failed'] },
    { name: 'reasonCode', type: 'text' },
    { name: 'targetDraftRevision', type: 'number', required: true },
  ],
}
