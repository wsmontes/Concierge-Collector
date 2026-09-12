import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { buildConfig } from 'payload'
import { readEnv } from './src/env'
import { approvedBrowserOrigins } from './src/auth/access'
import { guardFeatureEndpoints } from './src/feature-flags'
import { recordWorkerHeartbeat } from './src/jobs/recordWorkerHeartbeat'
import { applyDraftOperationTask } from './src/jobs/applyDraftOperationTask'
import { publishCollectionTask } from './src/jobs/publishCollectionTask'
import { reconcileLeasesTask } from './src/jobs/reconcileLeasesTask'
import { purgeExpiredArtifactsTask } from './src/jobs/purgeExpiredArtifactsTask'
import { collectionEndpoints } from './src/payload/endpoints/collections'
import { operationEndpoints } from './src/payload/endpoints/operations'
import { operationsAdminEndpoints } from './src/payload/endpoints/operations-admin'
import { publishingEndpoints } from './src/payload/endpoints/publishing'
import { collectionReadEndpoints } from './src/payload/endpoints/collection-reads'
import { collectorCollectionEndpoints } from './src/payload/endpoints/collector-collections'
import { applicationEndpoints } from './src/payload/endpoints/applications'
import { credentialEndpoints } from './src/payload/endpoints/credentials'
import { explorerEndpoints } from './src/payload/endpoints/explorer'
import { selectionEndpoints } from './src/payload/endpoints/selections'
import { exportEndpoints } from './src/payload/endpoints/exports'
import { materializeSelectionTask } from './src/jobs/materializeSelectionTask'
import { exportSelectionTask } from './src/jobs/exportSelectionTask'
import { syncConsumerUsageTask } from './src/jobs/syncConsumerUsage'
import {
  AuditEvents,
  CollectionDraftChanges,
  CollectionMemberships,
  CollectionOperationItems,
  CollectionOperations,
  CollectionPublishJobs,
  CollectionVersions,
  Collections,
  ConsumerApplications,
  ConsumerCredentials,
  CmsLoginStates,
  CmsSessions,
  CmsUsers,
  WorkerHeartbeats,
  SelectionManifests,
  SelectionManifestItems,
  CollectionExports,
  SavedCurationViews,
} from './src/payload/collections'

const env = readEnv()
const browserOrigins = approvedBrowserOrigins(env.publicServerUrl, env.collectorOrigins)

const collectionsAdminEndpoints = guardFeatureEndpoints('collections_admin', [
  ...collectionEndpoints(),
  ...collectionReadEndpoints(),
  ...collectorCollectionEndpoints(),
  ...operationEndpoints(),
  ...operationsAdminEndpoints(),
  ...publishingEndpoints(),
  ...explorerEndpoints(),
  ...selectionEndpoints(),
  ...exportEndpoints(),
])

const consumerCredentialEndpoints = guardFeatureEndpoints('consumer_credentials', [
  ...applicationEndpoints(),
  ...credentialEndpoints(),
])

export default buildConfig({
  serverURL: env.publicServerUrl,
  // O Collector fala com estes endpoints cross-origin (Bearer + headers
  // próprios). A forma de ARRAY usa só a lista default do Payload
  // (Origin/X-Requested-With/Content-Type/Accept/Authorization/...), que NÃO
  // cobre os headers que o cliente realmente envia — e o navegador recusa o
  // preflight quando um header pedido não está liberado. Como o Collector manda
  // `X-Request-Id` em TODA requisição, a funcionalidade de Collections ficava
  // bloqueada no browser mesmo com o roteamento correto.
  //
  // `X-Request-Id` e `Idempotency-Key` são observabilidade/idempotência de
  // escrita; `If-Match` é o CAS do rascunho (draftRevision). Nenhum curinga.
  cors: {
    origins: browserOrigins,
    headers: ['X-Request-Id', 'Idempotency-Key', 'If-Match'],
  },
  // Payload itself appends serverURL to CSRF during config sanitization.
  csrf: [...env.collectorOrigins],
  secret: env.payloadSecret,
  db: mongooseAdapter({
    url: env.cmsMongoUrl,
    // Migrations run only in the explicit release/manual command
    // (`payload migrate`), never as web or worker boot side effects.
    migrationDir: 'src/migrations',
    // Os índices são propriedade EXCLUSIVA das migrations.
    //
    // Sem isto o Mongoose cria os seus por conta própria no boot (autoIndex
    // default = true), com os nomes PADRÃO (`slug_1`, `eventKey_1`), enquanto
    // as migrations criam os mesmos campos com nomes explícitos
    // (`collections_slug_unique`, `audit_event_key_unique`). O Mongo não aceita
    // dois índices com a mesma chave e nomes diferentes, então o primeiro boot
    // do Admin em produção criava os nomes default e a migration seguinte
    // falhava com "Index already exists with a different name: slug_1" —
    // deixando o schema sem os índices que a suíte de integração exige
    // (tests/integration/payload/collection-indexes.int.test.ts).
    //
    // O Payload não cria índices por si (`ensureIndexes` já é false); quem
    // criava era o Mongoose, com `autoIndex` default = true. É esse que
    // desligamos, no nível da CONEXÃO: `collectionsSchemaOptions` é indexado
    // por slug de coleção (`?.[collection.slug]`), então `{ autoIndex: false }`
    // ali não teria efeito nenhum. Verificado empiricamente: com
    // connectOptions.autoIndex=false nenhum índice é criado no boot.
    connectOptions: {
      dbName: env.cmsDatabaseName,
      autoIndex: false,
    },
  }),
  admin: {
    user: 'cms-users',
    meta: {
      titleSuffix: '— Concierge',
    },
    components: {
      Nav: {
        path: '/src/components/shell/CmsNav',
        exportName: 'CmsNav',
      },
      graphics: {
        Icon: {
          path: '/src/components/shell/CmsNav',
          exportName: 'CmsIcon',
        },
        Logo: {
          path: '/src/components/shell/CmsNav',
          exportName: 'CmsLogo',
        },
      },
    },
  },
  collections: [
    CmsUsers,
    CmsLoginStates,
    CmsSessions,
    WorkerHeartbeats,
    SelectionManifests,
    SelectionManifestItems,
    CollectionExports,
    Collections,
    CollectionVersions,
    CollectionMemberships,
    CollectionDraftChanges,
    CollectionOperations,
    CollectionOperationItems,
    CollectionPublishJobs,
    AuditEvents,
    ConsumerApplications,
    ConsumerCredentials,
    SavedCurationViews,
  ],
  endpoints: [...collectionsAdminEndpoints, ...consumerCredentialEndpoints],
  jobs: {
    access: {
      cancel: () => false,
      queue: () => false,
      run: () => false,
    },
    processingOrder: 'createdAt',
    tasks: [
      recordWorkerHeartbeat,
      reconcileLeasesTask,
      purgeExpiredArtifactsTask,
      applyDraftOperationTask,
      publishCollectionTask,
      materializeSelectionTask,
      exportSelectionTask,
      syncConsumerUsageTask,
    ],
  },
  typescript: {
    outputFile: './src/payload/generated/payload-types.ts',
  },
})