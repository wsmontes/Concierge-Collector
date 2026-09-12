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

    // Origens continuam sendo allowlist exata (sem curinga). O formato passou de
    // array para objeto porque a forma de array usa apenas a lista DEFAULT de
    // headers do Payload — insuficiente para o Collector, que envia headers
    // próprios e teria o preflight recusado pelo navegador.
    expect(config.cors).toEqual({
      origins: [
        'https://admin.example.test',
        'https://concierge-collector.com',
        'https://staging.concierge-collector.com',
      ],
      headers: ['X-Request-Id', 'Idempotency-Key', 'If-Match'],
    })
    expect(config.csrf).toEqual([
      'https://concierge-collector.com',
      'https://staging.concierge-collector.com',
      'https://admin.example.test',
    ])
  })

  test('never widens CORS to a wildcard or reflects an unknown origin', async () => {
    const { default: pendingConfig } = await import('../../../payload.config')
    const config = await pendingConfig
    const cors = config.cors as { origins: string[]; headers: string[] }

    expect(cors.origins).not.toContain('*')
    expect(cors.headers).not.toContain('*')
    // Cada header liberado precisa ser um dos que o cliente realmente envia:
    // liberar a mais reabre a superfície; liberar a menos quebra o preflight.
    expect([...cors.headers].sort()).toEqual(['Idempotency-Key', 'If-Match', 'X-Request-Id'].sort())
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
      'post /admin/v1/collections/:id/draft/operations',
      'post /admin/v1/collections/:id/publish',
      'get /admin/v1/collections/:id/members',
      'get /admin/v1/collections/:id/draft/diff',
      'get /admin/v1/collections/:id/versions',
      'get /admin/v1/collections/:id/activity',
      'get /admin/v1/operations/:id',
      'post /admin/v1/operations/:id/cancel',
    ]))
  })

  test('registers the draft mutation task on the dedicated worker config', async () => {
    const { default: pendingConfig } = await import('../../../payload.config')
    const config = await pendingConfig

    expect(config.jobs?.tasks).toContainEqual(expect.objectContaining({
      slug: 'apply-draft-operation',
      retries: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
      },
    }))
    expect(config.jobs?.tasks).toContainEqual(expect.objectContaining({
      slug: 'publish-collection',
      retries: { attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
    }))
  })

  test('persists the request correlation ID required by draft-operation audits', async () => {
    const { CollectionOperations } = await import('../../../src/payload/collections/CollectionOperations')

    expect(CollectionOperations.fields).toContainEqual(expect.objectContaining({ name: 'requestId', required: true }))
  })

  test('denies native Payload writes while retaining bounded Payload history configuration', async () => {
    const { Collections } = await import('../../../src/payload/collections/Collections')

    expect(Collections.access?.create?.({} as never)).toBe(false)
    expect(Collections.access?.update?.({} as never)).toBe(false)
    expect(Collections.access?.delete?.({} as never)).toBe(false)
    expect(Collections.versions).toEqual({ maxPerDoc: 50 })
  })
})
