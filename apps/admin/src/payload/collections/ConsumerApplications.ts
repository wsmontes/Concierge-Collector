import type { Access, CollectionConfig } from 'payload'
import { isAuthorizedAdmin } from '../../auth/access'

const adminAccess: Access = ({ req }) => isAuthorizedAdmin(req.user)

/** Consumer-facing applications; all mutations use the guarded command API. */
export const ConsumerApplications: CollectionConfig = {
  slug: 'consumer-applications',
  dbName: 'consumer_applications',
  // Menu do Admin: as duas collections nativas do consumidor vivem no grupo
  // `Distribution` (`CMS_NAV_GROUPS`), ao lado da tela Applications.
  admin: {
    useAsTitle: 'name',
    group: 'Distribution',
    description: 'Applications that call the consumer API, and the Collection access granted to each.',
    defaultColumns: ['name', 'owner', 'status', 'allowedCollectionIds', 'defaultRequestsPerMinute'],
    listSearchableFields: ['name', 'owner'],
  },
  access: { create: () => false, read: adminAccess, update: () => false, delete: () => false },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true, index: true },
    { name: 'owner', type: 'text', required: true, index: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: ['active', 'suspended'],
      index: true,
      admin: {
        // Verificado em `concierge-api-v3/app/services/consumer_auth_service.py`:
        // a autenticação exige `status: 'active'` na application.
        description: 'Suspended Applications cannot authenticate any credential.',
        components: { Cell: '/src/components/content/cells/StatusCell#ApplicationStatusCell' },
      },
    },
    {
      name: 'allowedCollectionIds',
      type: 'array',
      required: true,
      label: 'Collection access',
      admin: {
        description: 'Collections this Application may read through the consumer API.',
        components: { Cell: '/src/components/content/cells/CollectionAccessCell#CollectionAccessCell' },
      },
      fields: [{ name: 'collectionId', type: 'text', required: true }],
    },
    {
      name: 'defaultRequestsPerMinute',
      type: 'number',
      required: true,
      defaultValue: 60,
      label: 'Requests per minute',
      admin: { description: 'Request budget per minute granted to this Application.' },
    },
    {
      name: 'credentialsRevision',
      type: 'number',
      required: true,
      defaultValue: 0,
      label: 'Credential changes',
    },
    { name: 'revision', type: 'number', required: true, defaultValue: 1, label: 'Record revision' },
  ],
}
