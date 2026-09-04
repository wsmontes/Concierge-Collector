import type { CollectionConfig } from 'payload'

/**
 * One selection-export attempt. The record is the CMS-side reference for an
 * artifact stored in private object storage: only `key`, `contentType` and the
 * post-upload `sha256` are persisted. `expiresAt` is a maintenance scan key,
 * not a Mongo TTL: cleanup deletes the private object first and removes this
 * reference only after DeleteObject succeeds (or when no object was created).
 *
 * Cleanup retry fields are operational only. A failed DeleteObject keeps the
 * reference and schedules bounded exponential backoff so one poisoned object
 * cannot monopolize every maintenance batch.
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
    { name: 'status', type: 'select', required: true, options: ['queued', 'running', 'complete', 'failed'], index: true },
    { name: 'progress', type: 'json' },
    { name: 'key', type: 'text' },
    { name: 'contentType', type: 'text' },
    { name: 'sha256', type: 'text' },
    // Migration 011 removed the legacy TTL. Migration 015 adds the due-cleanup
    // compound index that includes the retry backoff field below.
    { name: 'expiresAt', type: 'date', required: true },
    { name: 'cleanupAttempts', type: 'number' },
    { name: 'cleanupLastAttemptAt', type: 'date' },
    { name: 'cleanupNextAttemptAt', type: 'date' },
    { name: 'idempotencyKey', type: 'text', required: true },
    { name: 'requestHash', type: 'text', required: true },
    { name: 'requestId', type: 'text', required: true },
    { name: 'payloadJobId', type: 'text' },
    { name: 'leaseOwner', type: 'text' },
    { name: 'leaseExpiresAt', type: 'date', index: true },
    { name: 'fencingToken', type: 'number', required: true, defaultValue: 0 },
  ],
}