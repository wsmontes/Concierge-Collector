import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env = {
    ...originalEnv,
    CMS_MONGODB_URL: 'mongodb://localhost:27017',
    CMS_SERVICE_KEY: 'test-cms-service-key',
    FASTAPI_BASE_URL: 'https://api.example.test',
    PAYLOAD_SECRET: 'x'.repeat(32),
    CMS_PUBLIC_SERVER_URL: 'https://admin.example.test',
    CMS_COLLECTOR_ORIGINS: 'https://concierge-collector.com, https://staging.concierge-collector.com/',
  }
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('Payload browser security configuration', () => {
  test('allows CSRF and CORS only from the Admin and explicit Collector origins', async () => {
    const { default: pendingConfig } = await import('../../../payload.config')
    const config = await pendingConfig

    expect(config.cors).toEqual([
      'https://admin.example.test',
      'https://concierge-collector.com',
      'https://staging.concierge-collector.com',
    ])
    expect(config.csrf).toEqual([
      'https://concierge-collector.com',
      'https://staging.concierge-collector.com',
      'https://admin.example.test',
    ])
  })

  test('registers the lifecycle API as guarded root endpoints', async () => {
    const { default: pendingConfig } = await import('../../../payload.config')
    const config = await pendingConfig

    expect(config.endpoints.map(({ method, path }) => `${method} ${path}`)).toEqual(expect.arrayContaining([
      'post /admin/v1/collections',
      'get /admin/v1/collections/:id',
      'patch /admin/v1/collections/:id',
      'delete /admin/v1/collections/:id',
      'post /admin/v1/collections/:id/archive',
      'post /admin/v1/collections/:id/restore',
    ]))
  })

  test('denies native Payload writes while retaining bounded Payload history configuration', async () => {
    const { Collections } = await import('../../../src/payload/collections/Collections')

    expect(Collections.access?.create?.({} as never)).toBe(false)
    expect(Collections.access?.update?.({} as never)).toBe(false)
    expect(Collections.access?.delete?.({} as never)).toBe(false)
    expect(Collections.versions).toEqual({ maxPerDoc: 50 })
  })
})
