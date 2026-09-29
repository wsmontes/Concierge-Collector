import type { AuthStrategyFunctionArgs } from 'payload'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveCmsSession: vi.fn(),
}))

vi.mock('../../../src/auth/cms-session', () => ({
  resolveCmsSession: mocks.resolveCmsSession,
  revokeCmsSession: vi.fn(),
}))

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env = {
    ...originalEnv,
    CMS_MONGODB_URL: 'mongodb://localhost:27017',
    CMS_SERVICE_KEY: 'test-cms-service-key',
    FASTAPI_BASE_URL: 'https://api.example.test',
    PAYLOAD_SECRET: 'x'.repeat(32),
    CMS_PUBLIC_SERVER_URL: 'https://admin.example.test',
  }
  mocks.resolveCmsSession.mockResolvedValue({ id: 'session-1', subject: 'user-1', user: 'cms-user-1' })
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.clearAllMocks()
})

describe('cmsSessionStrategy', () => {
  test.each([
    ['an evil Origin', { origin: 'https://evil.example.test' }],
    ['a same-site sibling Origin', { origin: 'https://collector.example.test' }],
    ['a cross-site no-Origin request', { 'Sec-Fetch-Site': 'cross-site' }],
  ])('does not authenticate a CMS cookie from %s', async (_label, headers) => {
    const { cmsSessionStrategy } = await import('../../../src/auth/cms-strategy')
    const result = await cmsSessionStrategy.authenticate({
      headers: new Headers({ cookie: 'cms_session=session-token', ...headers }),
      payload: {} as never,
    } as AuthStrategyFunctionArgs)

    expect(result).toEqual({ user: null })
  })
})
