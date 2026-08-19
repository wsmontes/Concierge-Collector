import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Payload } from 'payload'

const skipMongoIntegration = process.env.CMS_SKIP_MONGO_INTEGRATION === '1'
const integrationSuite = skipMongoIntegration ? describe.skip : describe

let payload: Payload

function requireIntegrationDatabase(): void {
  const mongoUrl = process.env.CMS_MONGODB_URL?.trim()
  const databaseName = process.env.CMS_MONGODB_DB_NAME?.trim()

  if (!mongoUrl || !databaseName) {
    throw new Error(
      'Mongo integration requires CMS_MONGODB_URL and CMS_MONGODB_DB_NAME ending in -test. ' +
        'Set CMS_SKIP_MONGO_INTEGRATION=1 only to explicitly skip this suite.',
    )
  }

  if (!databaseName.endsWith('-test')) {
    throw new Error(`Refusing CMS integration database without -test suffix: ${databaseName}`)
  }
}

integrationSuite('worker heartbeat', () => {
  beforeAll(async () => {
    requireIntegrationDatabase()
    process.env.CMS_SERVICE_KEY ??= 'integration-cms-service-key'
    process.env.FASTAPI_BASE_URL ??= 'http://localhost:8000'
    process.env.PAYLOAD_SECRET ??= 'integration-payload-secret-with-at-least-32-characters'
    process.env.CMS_PUBLIC_SERVER_URL ??= 'http://localhost:3000'

    const [{ getPayload }, { default: config }] = await Promise.all([
      import('payload'),
      import('../../../payload.config'),
    ])
    payload = await getPayload({ config })
  })

  afterAll(async () => {
    await payload?.destroy()
  })

  test('job executed by the local API records a queryable heartbeat', async () => {
    const workerId = `integration-worker-${crypto.randomUUID()}`
    const job = await payload.jobs.queue({
      task: 'record-worker-heartbeat',
      queue: 'maintenance',
      input: { workerId },
      overrideAccess: true,
    })

    await payload.jobs.runByID({ id: job.id, overrideAccess: true })

    const rows = await payload.find({
      collection: 'worker-heartbeats',
      where: { workerId: { equals: workerId } },
      limit: 1,
      overrideAccess: true,
    })

    expect(rows.docs).toHaveLength(1)
    expect(rows.docs[0]?.observedAt).toEqual(expect.any(String))
  })
})
