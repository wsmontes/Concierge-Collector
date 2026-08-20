import type { CollectionConfig } from 'payload'

export const CmsSessions: CollectionConfig = {
  slug: 'cms-sessions',
  dbName: 'cms_sessions',
  admin: { hidden: true },
  access: {
    create: () => false,
    delete: () => false,
    read: () => false,
    update: () => false,
  },
  fields: [
    { name: 'sessionHash', type: 'text', required: true },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'cms-users',
      required: true,
      index: true,
    },
    { name: 'subject', type: 'text', required: true, index: true },
    { name: 'expiresAt', type: 'date', required: true },
    { name: 'revokedAt', type: 'date' },
  ],
}
