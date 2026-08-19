import type { CollectionConfig } from 'payload'

export const CmsLoginStates: CollectionConfig = {
  slug: 'cms-login-states',
  dbName: 'cms_login_states',
  admin: { hidden: true },
  access: {
    create: () => false,
    delete: () => false,
    read: () => false,
    update: () => false,
  },
  fields: [
    { name: 'stateHash', type: 'text', required: true },
    { name: 'returnTo', type: 'text', required: true },
    { name: 'expiresAt', type: 'date', required: true },
    { name: 'consumedAt', type: 'date' },
  ],
}
