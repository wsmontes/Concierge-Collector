import { MongoClient, type Db } from 'mongodb'
import { afterAll, beforeAll } from 'vitest'

const databaseName = process.env.CMS_MONGODB_DB_NAME?.trim()
const mongoUrl = process.env.CMS_MONGODB_URL?.trim()
const skipMongoIntegration = process.env.CMS_SKIP_MONGO_INTEGRATION === '1'

if (!skipMongoIntegration && (!mongoUrl || !databaseName)) {
  throw new Error(
    'Mongo integration requires CMS_MONGODB_URL and CMS_MONGODB_DB_NAME ending in -test. ' +
      'Set CMS_SKIP_MONGO_INTEGRATION=1 only to explicitly skip this suite.',
  )
}

if (!skipMongoIntegration && !databaseName?.endsWith('-test')) {
  throw new Error(`Refusing CMS integration database without -test suffix: ${databaseName}`)
}

const client = skipMongoIntegration ? undefined : new MongoClient(mongoUrl!)
export const cmsDb: Db = client?.db(databaseName) as Db

export async function clearCmsCollections(names: readonly string[]): Promise<void> {
  await Promise.all(names.map((name) => cmsDb.collection(name).deleteMany({})))
}

beforeAll(async () => {
  await client?.connect()
})

afterAll(async () => {
  await client?.close()
})
