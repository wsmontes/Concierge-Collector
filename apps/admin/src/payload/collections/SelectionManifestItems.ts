import type { CollectionConfig } from 'payload'

/** Each member is one small row so manifests stay streamable at any scale. */
export const SelectionManifestItems: CollectionConfig = {
  slug: 'selection-manifest-items',
  dbName: 'selection_manifest_items',
  admin: { hidden: true },
  access: { create: () => false, read: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'selectionId', type: 'text', required: true, index: true },
    { name: 'curationId', type: 'text', required: true, index: true },
    { name: 'retainedUntil', type: 'date', index: true },
    { name: 'expiresAt', type: 'date', required: true, index: true },
  ],
}
