import type { Access, CollectionConfig } from 'payload'
import { isAuthorizedAdmin } from '../../auth/access'

const adminAccess: Access = ({ req }) => isAuthorizedAdmin(req.user)

/**
 * The editable aggregate for an editorial Collection. Membership and publishing
 * data deliberately live in separate, indexed operational collections.
 */
export const Collections: CollectionConfig = {
  slug: 'collections',
  dbName: 'collections',
  admin: {
    useAsTitle: 'title',
    group: 'Content',
    components: {
      // A list view nativa é somente-leitura (create/update/delete = false) e não
      // expressa lifecycle/publish; o workspace é a lista canônica desta collection.
      // `path: '/:id'` resolve para `/collections/collections/:id`
      // (getCustomCollectionViewByRoute faz `baseRoute + view.path`); `exact: true`
      // impede que a view engula `/admin/collections/collections/<id>/versions`.
      views: {
        list: { Component: '/src/components/shell/CmsAdminViews#CollectionsAdminView' },
        workspace: {
          Component: '/src/components/shell/CmsAdminViews#CollectionDetailAdminView',
          path: '/:id',
          exact: true,
        },
      },
    },
  },
  access: {
    // Lifecycle writes are allowed only through the guarded command endpoints.
    // Native Payload REST/Admin creation would bypass CAS, idempotency and audit.
    create: () => false,
    read: adminAccess,
    update: () => false,
    delete: () => false,
  },
  // Domain publication history is the authoritative collection-versions model.
  // Payload's bounded document history is retained as the declared CMS config.
  versions: { maxPerDoc: 50 },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'title', type: 'text', required: true },
    { name: 'description', type: 'textarea' },
    {
      name: 'lifecycle',
      type: 'select',
      required: true,
      options: ['draft', 'published', 'archived'],
      defaultValue: 'draft',
      index: true,
    },
    { name: 'currentPublishedVersion', type: 'number' },
    { name: 'draftBaseVersion', type: 'number' },
    { name: 'draftEpoch', type: 'text', required: true, index: true },
    { name: 'draftRevision', type: 'number', required: true, defaultValue: 0 },
    // Mirrors the durable publish-job fence during a promotion. A stale worker
    // cannot move the production pointer after a lease takeover.
    { name: 'publishFencingToken', type: 'number', required: true, defaultValue: 0 },
    // Monotonic per-Collection queue sequence for serialized draft commands.
    { name: 'operationSequenceCounter', type: 'number', required: true, defaultValue: 0 },
    {
      name: 'draftState',
      type: 'select',
      required: true,
      options: ['clean', 'dirty', 'publishing', 'failed'],
      defaultValue: 'clean',
      index: true,
    },
    { name: 'publishedSelectedCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'draftSelectedCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'revision', type: 'number', required: true, defaultValue: 1 },
    { name: 'everPublished', type: 'checkbox', required: true, defaultValue: false },
  ],
}
