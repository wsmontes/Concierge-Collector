import type { CollectionConfig } from 'payload'

/** Durable server-side selection intent; it never stores the all-matching universe inline. */
export const SelectionManifests: CollectionConfig = {
  slug: 'selection-manifests',
  dbName: 'selection_manifests',
  admin: { hidden: true },
  access: { create: () => false, read: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'actorId', type: 'text', required: true, index: true },
    { name: 'mode', type: 'select', required: true, options: ['explicit', 'all_matching'] },
    { name: 'filters', type: 'json' },
    { name: 'excludedIds', type: 'json' },
    { name: 'scanToken', type: 'text' },
    { name: 'checkpointCursor', type: 'text' },
    { name: 'scanComplete', type: 'checkbox', required: true, defaultValue: false },
    { name: 'candidateCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'capturedCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'skippedCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'skippedReasons', type: 'json' },
    { name: 'manifestHash', type: 'text' },
    { name: 'status', type: 'select', required: true, options: ['queued', 'materializing', 'ready', 'failed', 'expired'], index: true },
    { name: 'leaseOwner', type: 'text' },
    { name: 'leaseExpiresAt', type: 'date', index: true },
    { name: 'fencingToken', type: 'number', required: true, defaultValue: 0 },
    { name: 'idempotencyKey', type: 'text', required: true },
    { name: 'requestHash', type: 'text', required: true },
    { name: 'requestId', type: 'text', required: true },
    { name: 'payloadJobId', type: 'text' },
    { name: 'expiresAt', type: 'date', required: true, index: true },
  ],
}
