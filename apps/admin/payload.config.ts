import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { buildConfig } from 'payload'
import { readEnv } from './src/env'
import { approvedBrowserOrigins } from './src/auth/access'
import { recordWorkerHeartbeat } from './src/jobs/recordWorkerHeartbeat'
import { collectionEndpoints } from './src/payload/endpoints/collections'
import {
  AuditEvents,
  CollectionDraftChanges,
  CollectionMemberships,
  CollectionOperationItems,
  CollectionOperations,
  CollectionPublishJobs,
  CollectionVersions,
  Collections,
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
  ],
  endpoints: collectionEndpoints(),
  jobs: {
    access: {
      cancel: () => false,
      queue: () => false,
      run: () => false,
    },
    processingOrder: 'createdAt',
    tasks: [recordWorkerHeartbeat],
  },
  typescript: {
    outputFile: './src/payload/generated/payload-types.ts',
  },
})
