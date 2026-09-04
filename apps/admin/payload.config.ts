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
import { archiveAuditEventsTask } from './src/jobs/archiveAuditEventsTask'
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
  AuditArchiveManifests,
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
  cors: browserOrigins,
  // Payload itself appends serverURL to CSRF during config sanitization.
  csrf: [...env.collectorOrigins],
  secret: env.payloadSecret,
  db: mongooseAdapter({
    url: env.cmsMongoUrl,
    // Migrations run only in the explicit release/manual command
    // (`payload migrate`), never as web or worker boot side effects.
    migrationDir: 'src/migrations',
    connectOptions: {
      dbName: env.cmsDatabaseName,
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
    AuditArchiveManifests,
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
    // Payload 3.86 defaults this to true; keep it explicit because successful
    // scheduled jobs (notably minute-level heartbeats) must not accumulate in
    // `payload-jobs`. Failed/incomplete jobs remain available to reconciliation.
    deleteJobOnComplete: true,
    processingOrder: 'createdAt',
    tasks: [
      recordWorkerHeartbeat,
      reconcileLeasesTask,
      purgeExpiredArtifactsTask,
      archiveAuditEventsTask,
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
