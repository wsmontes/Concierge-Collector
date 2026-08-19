import type { Access, CollectionConfig } from 'payload'
import { isAuthorizedAdmin } from '../../auth/access'

const adminAccess: Access = ({ req }) => isAuthorizedAdmin(req.user)

/** Hash-only credential records. The raw `cck_…` secret has no field here. */
export const ConsumerCredentials: CollectionConfig = {
  slug: 'consumer-credentials',
  dbName: 'consumer_credentials',
  admin: { useAsTitle: 'name', group: 'Applications' },
  access: { create: () => false, read: adminAccess, update: () => false, delete: () => false },
  fields: [
    { name: 'applicationId', type: 'text', required: true, index: true },
    { name: 'name', type: 'text', required: true },
    { name: 'prefix', type: 'text', required: true, index: true },
    { name: 'secretHash', type: 'text', required: true, admin: { hidden: true } },
    { name: 'issueIdempotencyKey', type: 'text', required: true, admin: { hidden: true } },
    { name: 'scopes', type: 'select', required: true, hasMany: true, options: ['collections:read'] },
    { name: 'status', type: 'select', required: true, defaultValue: 'active', options: ['active', 'revoked'], index: true },
    { name: 'createdBy', type: 'text', required: true },
    { name: 'expiresAt', type: 'date', index: true },
    { name: 'revokedAt', type: 'date' },
    { name: 'revokedBy', type: 'text' },
    { name: 'lastUsedAt', type: 'date' },
  ],
}
