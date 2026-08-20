import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { buildConfig } from 'payload'
import { readEnv } from './src/env'
import { approvedBrowserOrigins } from './src/auth/access'
import { recordWorkerHeartbeat } from './src/jobs/recordWorkerHeartbeat'
import { applyDraftOperationTask } from './src/jobs/applyDraftOperationTask'
import { publishCollectionTask } from './src/jobs/publishCollectionTask'
import { collectionEndpoints } from './src/payload/endpoints/collections'
import { operationEndpoints } from './src/payload/endpoints/operations'
import { publishingEndpoints } from './src/payload/endpoints/publishing'
import { collectionReadEndpoints } from './src/payload/endpoints/collection-reads'
import { collectorCollectionEndpoints } from './src/payload/endpoints/collector-collections'
import { applicationEndpoints } from './src/payload/endpoints/applications'
import { explorerEndpoints } from './src/payload/endpoints/explorer'
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
} from './src/payload/collections'

const env = readEnv()
const browserOrigins = approvedBrowserOrigins(env.publicServerUrl, env.collectorOrigins)

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
  ],
  endpoints: [...collectionEndpoints(), ...collectionReadEndpoints(), ...collectorCollectionEndpoints(), ...operationEndpoints(), ...publishingEndpoints(), ...applicationEndpoints(), ...explorerEndpoints()],
  jobs: {
    access: {
      cancel: () => false,
      queue: () => false,
      run: () => false,
    },
    processingOrder: 'createdAt',
    tasks: [recordWorkerHeartbeat, applyDraftOperationTask, publishCollectionTask],
  },
  typescript: {
    outputFile: './src/payload/generated/payload-types.ts',
  },
})
