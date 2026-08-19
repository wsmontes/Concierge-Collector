import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { buildConfig } from 'payload'
import { readEnv } from './src/env'
import { approvedBrowserOrigins } from './src/auth/access'
import { recordWorkerHeartbeat } from './src/jobs/recordWorkerHeartbeat'
import { CmsLoginStates, CmsSessions, CmsUsers, WorkerHeartbeats } from './src/payload/collections'
import { down as authMigrationDown, up as authMigrationUp } from './src/migrations/20260818_000_auth'

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
    connectOptions: {
      dbName: env.cmsDatabaseName,
    },
    prodMigrations: [
      {
        name: '20260818_000_auth',
        up: authMigrationUp,
        down: authMigrationDown,
      },
    ],
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
  collections: [CmsUsers, CmsLoginStates, CmsSessions, WorkerHeartbeats],
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
