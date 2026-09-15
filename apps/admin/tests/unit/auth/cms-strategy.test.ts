import type { AuthStrategyFunctionArgs } from 'payload'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveCmsSession: vi.fn(),
  introspect: vi.fn(),
}))

vi.mock('../../../src/auth/cms-session', () => ({
  resolveCmsSession: mocks.resolveCmsSession,
  revokeCmsSession: vi.fn(),
}))

vi.mock('../../../src/auth/fastapi-authz-client', () => ({
  FastApiAuthzClient: class {
    introspectSubject = mocks.introspect
  },
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

  const adminIdentity = {
    authz_revision: 'r1',
    authorized: true,
    email: 'admin@example.test',
    name: 'Admin',
    picture: null,
    role: 'admin',
    user_id: 'user-1',
  }
  const mirroredRow = { id: 'cms-user-1', email: 'admin@example.test', role: 'admin', authorized: true }

  test('keeps the admin session when the mirror write loses a race but the row exists', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.introspect.mockResolvedValue(adminIdentity)
    const { cmsSessionStrategy } = await import('../../../src/auth/cms-strategy')

    const result = await cmsSessionStrategy.authenticate({
      headers: new Headers({ cookie: 'cms_session=session-token', origin: 'https://admin.example.test' }),
      payload: {
        find: vi.fn().mockResolvedValue({ docs: [mirroredRow] }),
        update: vi.fn().mockRejectedValue(
          new Error('Write conflict during plan execution and yielding is disabled'),
        ),
      },
    } as never)

    // Antes: qualquer falha do espelho devolvia `user: null` e o Admin mandava o
    // curador para o login no meio da sessão.
    expect(result).toMatchObject({ user: { id: 'cms-user-1', collection: 'cms-users' } })
    expect(warn).toHaveBeenCalledWith('[cms-session] cms-users mirror failed', expect.any(Error))
  })

  test('still refuses a session the mirror never recorded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.introspect.mockResolvedValue(adminIdentity)
    const { cmsSessionStrategy } = await import('../../../src/auth/cms-strategy')

    const result = await cmsSessionStrategy.authenticate({
      headers: new Headers({ cookie: 'cms_session=session-token', origin: 'https://admin.example.test' }),
      payload: {
        find: vi.fn().mockResolvedValue({ docs: [] }),
        create: vi.fn().mockRejectedValue(new Error('write conflict')),
      },
    } as never)

    // Sem linha espelhada não há usuário do CMS: primeiro acesso falho segue recusado.
    expect(result).toEqual({ user: null })
  })
})
