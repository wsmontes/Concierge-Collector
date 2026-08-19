import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { buildConfig } from 'payload'
import { readEnv } from './src/env'
import { CmsUsers } from './src/payload/collections'

const env = readEnv()

export default buildConfig({
  serverURL: env.publicServerUrl,
  secret: env.payloadSecret,
  db: mongooseAdapter({
    url: env.cmsMongoUrl,
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
  collections: [CmsUsers],
  typescript: {
    outputFile: './src/payload/generated/payload-types.ts',
  },
})
