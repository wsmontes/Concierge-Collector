import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { isTrustedCmsSessionRequest } from '../../../src/auth/cms-session-request-policy'

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
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('CMS session browser request policy', () => {
  test.each([
    ['an evil cross-origin request', { origin: 'https://evil.example.test' }],
    ['a same-site sibling-origin request', { origin: 'https://collector.example.test' }],
  ])('rejects %s', (_label, headers) => {
    expect(isTrustedCmsSessionRequest(new Headers(headers))).toBe(false)
  })

  test('accepts the configured Admin origin', () => {
    expect(isTrustedCmsSessionRequest(new Headers({ origin: 'https://admin.example.test' }))).toBe(true)
  })

  test.each([
    ['same-origin', true],
    ['none', true],
    ['same-site', false],
    ['cross-site', false],
    [null, false],
  ])('uses Sec-Fetch-Site for a no-Origin navigation: %s', (fetchSite, allowed) => {
    const headers = new Headers()
    if (fetchSite) headers.set('Sec-Fetch-Site', fetchSite)

    expect(isTrustedCmsSessionRequest(headers)).toBe(allowed)
  })
})
