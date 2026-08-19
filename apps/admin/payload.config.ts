import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { buildConfig } from 'payload'
import { readEnv } from './src/env'

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
  collections: [],
  typescript: {
    outputFile: './src/payload/generated/payload-types.ts',
  },
})
