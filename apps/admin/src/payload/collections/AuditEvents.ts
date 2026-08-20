import type { CollectionConfig } from 'payload'

export const AuditEvents: CollectionConfig = {
  slug: 'audit-events',
  dbName: 'audit_events',
  admin: { hidden: true },
  access: { create: () => false, read: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'eventKey', type: 'text', required: true, unique: true },
    { name: 'eventType', type: 'text', required: true, index: true },
    { name: 'actorId', type: 'text', required: true, index: true },
    { name: 'requestId', type: 'text', required: true },
    { name: 'collectionId', type: 'text', index: true },
    { name: 'applicationId', type: 'text', index: true },
    { name: 'credentialId', type: 'text', index: true },
    { name: 'operationId', type: 'text' },
    { name: 'publicationJobId', type: 'text' },
    { name: 'beforeRevision', type: 'number' },
    { name: 'afterRevision', type: 'number' },
    { name: 'metadata', type: 'json', required: true },
  ],
}
