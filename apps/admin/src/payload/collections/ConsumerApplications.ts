import type { Access, CollectionConfig } from 'payload'
import { isAuthorizedAdmin } from '../../auth/access'

const adminAccess: Access = ({ req }) => isAuthorizedAdmin(req.user)

/** Consumer-facing applications; all mutations use the guarded command API. */
export const ConsumerApplications: CollectionConfig = {
  slug: 'consumer-applications',
  dbName: 'consumer_applications',
  admin: { useAsTitle: 'name', group: 'Applications' },
  access: { create: () => false, read: adminAccess, update: () => false, delete: () => false },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true, index: true },
    { name: 'owner', type: 'text', required: true, index: true },
    { name: 'status', type: 'select', required: true, defaultValue: 'active', options: ['active', 'suspended'], index: true },
    { name: 'allowedCollectionIds', type: 'array', required: true, fields: [{ name: 'collectionId', type: 'text', required: true }] },
    { name: 'defaultRequestsPerMinute', type: 'number', required: true, defaultValue: 60 },
    { name: 'credentialsRevision', type: 'number', required: true, defaultValue: 0 },
  ],
}
