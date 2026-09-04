import { afterEach, describe, expect, test } from 'vitest'
import { featureEnabled, guardFeatureEndpoints, requireFeature } from '../../src/feature-flags'

const original = { ...process.env }
afterEach(() => { process.env = { ...original } })

describe('Collections feature flags', () => {
  test('development/testing remains enabled when override is absent', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.ENVIRONMENT
    delete process.env.COLLECTIONS_ADMIN_ENABLED
    expect(featureEnabled('collections_admin')).toBe(true)
  })

  test('missing environment fails closed instead of assuming development', () => {
    delete process.env.NODE_ENV
    delete process.env.ENVIRONMENT
    delete process.env.COLLECTIONS_ADMIN_ENABLED
    expect(featureEnabled('collections_admin')).toBe(false)
  })

  test('production fails closed when override is absent', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.COLLECTIONS_ADMIN_ENABLED
    expect(featureEnabled('collections_admin')).toBe(false)
    expect(() => requireFeature('collections_admin')).toThrow('feature_disabled')
    try {
      requireFeature('collections_admin')
    } catch (error) {
      expect(error).toMatchObject({ status: 503, code: 'feature_disabled', details: { flag: 'collections_admin' } })
    }
  })

  test('disabled endpoint returns the standard no-store admin error envelope', async () => {
    process.env.NODE_ENV = 'production'
    process.env.COLLECTIONS_ADMIN_ENABLED = 'false'
    const [endpoint] = guardFeatureEndpoints('collections_admin', [{
      method: 'get',
      path: '/admin/v1/example',
      handler: async () => Response.json({ shouldNotRun: true }),
    } as never])

    const response = await endpoint.handler({} as never)

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ error: { code: 'feature_disabled', flag: 'collections_admin' } })
  })

  test('explicit production override is validated', () => {
    process.env.NODE_ENV = 'production'
    process.env.COLLECTIONS_ADMIN_ENABLED = 'true'
    expect(featureEnabled('collections_admin')).toBe(true)
    process.env.COLLECTIONS_ADMIN_ENABLED = 'yes'
    expect(() => featureEnabled('collections_admin')).toThrow('COLLECTIONS_ADMIN_ENABLED must be true or false')
  })
})