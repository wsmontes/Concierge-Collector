import type { Access, CollectionConfig } from 'payload'
import { isAuthorizedAdmin } from '../../auth/access'

const adminAccess: Access = ({ req }) => isAuthorizedAdmin(req.user)

/** Hash-only credential records. The raw `cck_…` secret has no field here. */
export const ConsumerCredentials: CollectionConfig = {
  slug: 'consumer-credentials',
  dbName: 'consumer_credentials',
  admin: {
    useAsTitle: 'name',
    group: 'Distribution',
    description: 'Credentials issued to Applications. Only hashes are stored — the raw secret is never kept.',
    // Dono, identificação no log, estado e último uso são o que decide revogar ou
    // rotacionar; o nome da credencial abre a lista (é o campo do título).
    // `expiresAt` aparece como estado derivado (a credencial vencida sai como
    // `Expired` na coluna de status), então o instante exato fica no detalhe.
    defaultColumns: ['name', 'prefix', 'applicationId', 'status', 'lastUsedAt'],
    listSearchableFields: ['name', 'prefix', 'applicationId'],
  },
  access: { create: () => false, read: adminAccess, update: () => false, delete: () => false },
  fields: [
    {
      name: 'applicationId',
      type: 'text',
      required: true,
      index: true,
      label: 'Application',
      admin: {
        description: 'Application this credential belongs to.',
        components: { Cell: '/src/components/content/cells/MonoCell#MonoCell' },
      },
    },
    { name: 'name', type: 'text', required: true },
    {
      name: 'prefix',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Lookup prefix of the issued secret (cck_…) — the only part of the secret kept in clear.',
        components: { Cell: '/src/components/content/cells/MonoCell#MonoCell' },
      },
    },
    { name: 'secretHash', type: 'text', required: true, admin: { hidden: true }, access: { read: () => false } },
    { name: 'issueIdempotencyKey', type: 'text', required: true, admin: { hidden: true }, access: { read: () => false } },
    { name: 'scopes', type: 'select', required: true, hasMany: true, options: ['collections:read'] },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: ['active', 'revoked'],
      index: true,
      admin: {
        // Verificado em `concierge-api-v3/app/services/consumer_auth_service.py`:
        // a autenticação exige `status: 'active'` e `expiresAt` no futuro.
        description: 'Revoked and expired credentials cannot authenticate.',
        components: { Cell: '/src/components/content/cells/StatusCell#CredentialStatusCell' },
      },
    },
    { name: 'createdBy', type: 'text', required: true },
    {
      name: 'expiresAt',
      type: 'date',
      index: true,
      admin: { description: 'A credential used past this instant can no longer authenticate.' },
    },
    { name: 'revokedAt', type: 'date' },
    { name: 'revokedBy', type: 'text' },
    {
      name: 'lastUsedAt',
      type: 'date',
      label: 'Last used',
      admin: {
        description: 'Last time this credential authenticated a request.',
        components: { Cell: '/src/components/content/cells/RelativeDateCell#RelativeDateCell' },
      },
    },
  ],
}
