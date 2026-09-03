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
    // TTL ownership lives in migration 010; do not auto-create a competing
    // normal index for the same key.
    { name: 'retainedUntil', type: 'date' },
    { name: 'expiresAt', type: 'date', required: true, index: true },
  ],
}
