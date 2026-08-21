import type { CollectionConfig } from 'payload'

/**
 * One selection-export attempt. The record is the CMS-side reference for an
 * artifact stored in private object storage: only `key`, `contentType` and the
 * post-upload `sha256` are persisted. Expiry is processed by the maintenance
 * worker, which deletes the object first and preserves this record as a
 * `purged` tombstone for operational evidence.
 */
export const CollectionExports: CollectionConfig = {
  slug: 'collection-exports',
  dbName: 'collection_exports',
  admin: { hidden: true },
  access: { create: () => false, read: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'selectionId', type: 'text', required: true, index: true },
    { name: 'actorId', type: 'text', required: true, index: true },
    { name: 'format', type: 'select', required: true, options: ['ndjson', 'csv'] },
    { name: 'status', type: 'select', required: true, options: ['queued', 'running', 'complete', 'failed', 'purged'], index: true },
    { name: 'progress', type: 'json' },
    { name: 'key', type: 'text' },
    { name: 'contentType', type: 'text' },
    { name: 'sha256', type: 'text' },
    // Migration 009 replaces the old Mongo TTL with a normal scan index so
    // object deletion can be confirmed before this record changes state.
    { name: 'expiresAt', type: 'date', required: true },
    { name: 'purgedAt', type: 'date' },
    { name: 'idempotencyKey', type: 'text', required: true },
    { name: 'requestHash', type: 'text', required: true },
    { name: 'requestId', type: 'text', required: true },
    { name: 'payloadJobId', type: 'text' },
    { name: 'leaseOwner', type: 'text' },
    { name: 'leaseExpiresAt', type: 'date', index: true },
    { name: 'fencingToken', type: 'number', required: true, defaultValue: 0 },
  ],
}
