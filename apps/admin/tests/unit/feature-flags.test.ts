import { afterEach, describe, expect, test } from 'vitest'
import { featureEnabled, requireFeature } from '../../src/feature-flags'

const original = { ...process.env }
afterEach(() => { process.env = { ...original } })

describe('Collections feature flags', () => {
  test('development/testing remains enabled when override is absent', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.COLLECTIONS_ADMIN_ENABLED
    expect(featureEnabled('collections_admin')).toBe(true)
  })

  test('production fails closed when override is absent', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.COLLECTIONS_ADMIN_ENABLED
    expect(featureEnabled('collections_admin')).toBe(false)
    expect(() => requireFeature('collections_admin')).toThrow('feature_disabled:collections_admin')
  })

  test('explicit production override is validated', () => {
    process.env.NODE_ENV = 'production'
    process.env.COLLECTIONS_ADMIN_ENABLED = 'true'
    expect(featureEnabled('collections_admin')).toBe(true)
    process.env.COLLECTIONS_ADMIN_ENABLED = 'yes'
    expect(() => featureEnabled('collections_admin')).toThrow('COLLECTIONS_ADMIN_ENABLED must be true or false')
  })
})
