import type { CollectionConfig } from 'payload'
import { isAuthenticated } from '../../auth/access'

/**
 * Private saved views of the Curation Explorer.
 *
 * Each document belongs to exactly one CMS user (the `owner` relationship to
 * cms-users) and the collection access denies every read/write outside the
 * owner scope. Creation is endpoint-only: the BFF
 * (`/api/admin/v1/curation-views`) derives the owner from the live admin
 * session, so a browser request can never attribute a view to someone else.
 */
export const SavedCurationViews: CollectionConfig = {
  slug: 'saved-curation-views',
  dbName: 'saved_curation_views',
  admin: {
    hidden: true,
    useAsTitle: 'name',
  },
  access: {
    create: () => false,
    read: ({ req }) => {
      if (!isAuthenticated(req.user)) return false
      return { owner: { equals: req.user?.id } }
    },
    update: ({ req }) => {
      if (!isAuthenticated(req.user)) return false
      return { owner: { equals: req.user?.id } }
    },
    delete: ({ req }) => {
      if (!isAuthenticated(req.user)) return false
      return { owner: { equals: req.user?.id } }
    },
  },
  fields: [
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'cms-users',
      required: true,
      index: true,
    },
    { name: 'name', type: 'text', required: true },
    { name: 'normalizedFilters', type: 'json' },
    { name: 'sort', type: 'json' },
    { name: 'visibleColumns', type: 'json' },
  ],
}
