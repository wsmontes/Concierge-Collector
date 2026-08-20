import type { CollectionConfig } from 'payload'

export const CollectionVersions: CollectionConfig = {
  slug: 'collection-versions',
  dbName: 'collection_versions',
  admin: { hidden: true },
  access: { create: () => false, read: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'collectionId', type: 'text', required: true, index: true },
    { name: 'version', type: 'number', required: true },
    { name: 'metadataSnapshot', type: 'json', required: true },
    { name: 'selectedCount', type: 'number', required: true },
    { name: 'membershipHash', type: 'text', required: true },
    { name: 'publicationJobId', type: 'text', required: true, index: true },
    { name: 'schemaVersion', type: 'number', required: true },
    { name: 'status', type: 'select', required: true, options: ['ready', 'published', 'failed'], index: true },
    { name: 'publishedAt', type: 'date' },
    { name: 'publishedBy', type: 'text' },
  ],
}
