import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  completeCmsHandoff: vi.fn(),
  cookies: vi.fn(),
  getPayload: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('payload', () => ({ getPayload: mocks.getPayload }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('../../../src/auth/cms-handoff', () => ({ completeCmsHandoff: mocks.completeCmsHandoff }))

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
  mocks.cookies.mockResolvedValue({ get: vi.fn(() => ({ value: 'state' })) })
  mocks.getPayload.mockResolvedValue({})
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.clearAllMocks()
})

describe('CMS callback', () => {
  test('redirects to the configured CMS public origin, never the callback Host', async () => {
    mocks.completeCmsHandoff.mockResolvedValue({ returnTo: '/admin/collections', session: 'session' })
    const { GET } = await import('../../../app/auth/callback/route')

    const response = await GET(new Request('https://attacker.example.test/auth/callback?code=code&state=state'))

    expect(response.headers.get('location')).toBe('https://admin.example.test/admin/collections')
  })

  test.each([
    ['Invalid CMS login state', 400],
    ['CMS admin access is required', 403],
    ['upstream exchange failed', 401],
  ])('clears the transient login cookie after terminal error: %s', async (message, status) => {
    mocks.completeCmsHandoff.mockRejectedValue(new Error(message))
    const { GET } = await import('../../../app/auth/callback/route')

    const response = await GET(new Request('https://admin.example.test/auth/callback?code=code&state=state'))

    expect(response.status).toBe(status)
    expect(response.headers.get('set-cookie')).toContain('cms_login_state=')
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970')
  })
})
