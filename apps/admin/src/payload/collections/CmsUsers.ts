import type { CollectionConfig } from 'payload'
import { isAuthenticated, isAuthorizedAdmin } from '../../auth/access'

export const CmsUsers: CollectionConfig = {
  slug: 'cms-users',
  dbName: 'cms_users',
  auth: {
    disableLocalStrategy: true,
  },
  admin: {
    useAsTitle: 'email',
  },
  access: {
    admin: ({ req }) => isAuthorizedAdmin(req.user),
    create: () => false,
    delete: () => false,
    read: ({ req }) => {
      if (!isAuthenticated(req.user)) return false

      return { id: { equals: req.user?.id } }
    },
    update: () => false,
  },
  fields: [
    {
      name: 'fastapiUserId',
      type: 'text',
      required: true,
      unique: true,
      admin: { readOnly: true },
    },
    {
      name: 'email',
      type: 'email',
      required: true,
      unique: true,
      admin: { readOnly: true },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { readOnly: true },
    },
    {
      name: 'picture',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'curator',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Curator', value: 'curator' },
        { label: 'Viewer', value: 'viewer' },
      ],
      admin: { readOnly: true },
    },
    {
      name: 'authorized',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      admin: { readOnly: true },
    },
    {
      name: 'authzRevision',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
      admin: { readOnly: true },
    },
    {
      name: 'lastIntrospectedAt',
      type: 'date',
      admin: { readOnly: true },
    },
  ],
}
