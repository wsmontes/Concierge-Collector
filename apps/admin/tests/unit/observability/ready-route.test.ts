import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ping: vi.fn(),
  getPayload: vi.fn(),
  checkSchema: vi.fn(),
}))

vi.mock('payload', () => ({ getPayload: mocks.getPayload }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('../../../src/operations/schema-readiness', () => ({
  checkCmsSchemaReadiness: mocks.checkSchema,
}))

import { GET } from '../../../app/ready/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ping.mockResolvedValue({ ok: 1 })
  mocks.getPayload.mockResolvedValue({ db: { connection: { db: { admin: () => ({ ping: mocks.ping }) } } } })
  mocks.checkSchema.mockResolvedValue({ ready: true, migration: 'ready', indexes: 'ready', missingIndexes: [] })
})

test('returns ready only after database and schema checks succeed', async () => {
  const response = await GET()

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    status: 'ready',
    service: 'concierge-admin',
    checks: { database: 'ready', schema: 'ready' },
  })
  expect(mocks.ping).toHaveBeenCalledTimes(1)
  expect(mocks.checkSchema).toHaveBeenCalledTimes(1)
})

test('returns 503 when schema is behind without attempting repair', async () => {
  mocks.checkSchema.mockResolvedValue({
    ready: false,
    migration: 'missing',
    indexes: 'missing',
    missingIndexes: ['collection-exports:export_expiry_status'],
  })

  const response = await GET()

  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({
    status: 'not_ready',
    service: 'concierge-admin',
    checks: { database: 'ready', schema: 'not_ready' },
  })
})

test('returns 503 with safe status when database ping fails', async () => {
  mocks.ping.mockRejectedValue(new Error('mongodb://secret-host/example'))

  const response = await GET()

  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({
    status: 'not_ready',
    service: 'concierge-admin',
    checks: { database: 'not_ready', schema: 'unknown' },
  })
  expect(mocks.checkSchema).not.toHaveBeenCalled()
})

test('fails closed when Payload has no Mongo database handle', async () => {
  mocks.getPayload.mockResolvedValue({ db: { connection: { db: undefined } } })

  const response = await GET()

  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({
    status: 'not_ready',
    service: 'concierge-admin',
    checks: { database: 'not_ready', schema: 'unknown' },
  })
  expect(mocks.ping).not.toHaveBeenCalled()
  expect(mocks.checkSchema).not.toHaveBeenCalled()
})
