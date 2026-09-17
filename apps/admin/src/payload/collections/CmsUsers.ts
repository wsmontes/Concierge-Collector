import type { CollectionConfig } from 'payload'
import { isAuthenticated, isAuthorizedAdmin } from '../../auth/access'
import { cmsSessionStrategy } from '../../auth/cms-strategy'

export const CmsUsers: CollectionConfig = {
  slug: 'cms-users',
  dbName: 'cms_users',
  auth: {
    disableLocalStrategy: true,
    strategies: [cmsSessionStrategy],
  },
  admin: {
    useAsTitle: 'email',
    // O menu do Admin é curado (`CMS_NAV_GROUPS`): o grupo declara a seção a que
    // esta collection pertence quando o Payload desenha a própria nav.
    group: 'Operations',
    description: 'Admin identities and the access level each one holds. Read-only: access is granted at sign-in.',
    // A lista responde "quem pode entrar, com que papel, e quando foi confirmado":
    // `fastapiUserId` fica de fora porque é chave de join com o FastAPI, não fato
    // de operação — a ficha do usuário o mostra.
    defaultColumns: ['email', 'name', 'role', 'authorized', 'lastIntrospectedAt'],
    listSearchableFields: ['email', 'name'],
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
      // Rótulo de produto: o nome do campo é jargão interno e vira rótulo visível.
      label: 'Sign-in user id',
      admin: {
        readOnly: true,
        description: 'Identifier of this user in the authorization service.',
      },
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
      admin: {
        readOnly: true,
        // Booleano como chip (`Yes`/`No`), não como o `<code>true</code>` cru da
        // lista nativa.
        components: { Cell: '/src/components/content/cells/BooleanCell#BooleanCell' },
      },
    },
    {
      name: 'authzRevision',
      type: 'text',
      required: true,
      label: 'Authorization revision',
      admin: {
        readOnly: true,
        description: 'Revision of the authorization state this copy was synced from.',
      },
    },
    {
      name: 'lastIntrospectedAt',
      type: 'date',
      label: 'Access confirmed',
      admin: {
        readOnly: true,
        description: 'When the FastAPI authorization service last confirmed this identity.',
        components: { Cell: '/src/components/content/cells/RelativeDateCell#RelativeDateCell' },
      },
    },
  ],
}
