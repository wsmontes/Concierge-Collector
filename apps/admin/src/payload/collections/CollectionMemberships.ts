import type { CollectionConfig } from 'payload'

export const CollectionMemberships: CollectionConfig = {
  slug: 'collection-memberships',
  dbName: 'collection_memberships',
  admin: { hidden: true },
  access: { create: () => false, read: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'collectionId', type: 'text', required: true, index: true },
    { name: 'curationId', type: 'text', required: true, index: true },
    { name: 'addedInVersion', type: 'number', required: true },
    { name: 'removedInVersion', type: 'number' },
    { name: 'createdBy', type: 'text', required: true },
  ],
}
