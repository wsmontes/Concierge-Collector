import { describe, expect, test } from 'vitest'

import { createReleasePlan, withAdminTestEnv } from '../scripts/release/release-gate.mjs'
import { findPython, resolvePythonCandidates } from '../scripts/release/run-python.mjs'

describe('Local release gate', () => {
  test('standard gate covers collector, admin, api and generated contracts', () => {
    const names = createReleasePlan('standard').map((step) => step.name)
    expect(names).toEqual([
      'Collector build freshness',
      'Collector lint',
      'Collector unit tests',
      'Admin unit tests',
      'Admin typecheck',
      'Admin build',
      'API unit tests',
      'API formatting',
      'API lint',
      'Generated contracts',
    ])
  })

  test('full gate extends standard with integration and browser coverage', () => {
    const standard = createReleasePlan('standard').map((step) => step.name)
    const full = createReleasePlan('full').map((step) => step.name)

    expect(full.slice(0, standard.length)).toEqual(standard)
    expect(full.slice(standard.length)).toEqual([
      'Admin integration tests',
      'API integration tests',
      'Admin browser E2E',
    ])
  })

  test('python candidates prefer explicit configuration before local and system interpreters', () => {
    const candidates = resolvePythonCandidates({
      env: { CONCIERGE_PYTHON: '/opt/python-custom', PYTHON: '/opt/python-fallback' },
      platform: 'linux',
      apiDir: '/repo/concierge-api-v3',
    })

    expect(candidates[0]).toBe('/opt/python-custom')
    expect(candidates[1]).toBe('/opt/python-fallback')
    expect(candidates).toContain('/repo/concierge-api-v3/venv/bin/python')
    expect(candidates).toContain('/repo/concierge-api-v3/.venv/bin/python')
    expect(candidates.slice(-2)).toEqual(['python3', 'python'])
  })

  test('python resolution falls back to a system interpreter when no repo venv exists', () => {
    const seen = []
    const python = findPython({
      env: {},
      platform: 'linux',
      apiDir: '/definitely/not/a/real/repo',
      spawn(command) {
        seen.push(command)
        return command === 'python3' ? { status: 0 } : { status: 1 }
      },
    })

    expect(python).toBe('python3')
    expect(seen).toEqual(['python3'])
  })

  test('full gate enables the live CMS E2E suites by default', () => {
    const e2e = createReleasePlan('full').find((step) => step.name === 'Admin browser E2E')

    expect(e2e.env.CMS_E2E_AUTH_HANDOFF).toBe('1')
    expect(e2e.env.CMS_E2E_PUBLISH).toBe('1')
    expect(e2e.env.CMS_E2E_EXPLORER).toBe('1')
  })

  test('full gate refuses remote E2E targets unless explicitly allowed', () => {
    expect(() =>
      createReleasePlan('full', {
        env: { CMS_E2E_BASE_URL: 'https://admin.production.example' },
      }),
    ).toThrow(/Refusing remote E2E target/)
  })

  test('full gate forces live E2E flags even when caller tries to disable them', () => {
    const e2e = createReleasePlan('full', {
      env: {
        CMS_E2E_AUTH_HANDOFF: '0',
        CMS_E2E_PUBLISH: '0',
        CMS_E2E_EXPLORER: '0',
      },
    }).find((step) => step.name === 'Admin browser E2E')

    expect(e2e.env.CMS_E2E_AUTH_HANDOFF).toBe('1')
    expect(e2e.env.CMS_E2E_PUBLISH).toBe('1')
    expect(e2e.env.CMS_E2E_EXPLORER).toBe('1')
  })

  test('admin test environment supplies safe defaults without overriding caller values', () => {
    const env = withAdminTestEnv({ CMS_MONGODB_URL: 'mongodb://custom:27017' })

    expect(env.CMS_MONGODB_URL).toBe('mongodb://custom:27017')
    expect(env.CMS_MONGODB_DB_NAME).toBe('concierge-cms-test')
    expect(env.CMS_SERVICE_KEY).toBe('test-cms-service-key')
    expect(env.PAYLOAD_SECRET).toBe('test-payload-secret-with-at-least-32-chars')
  })
})
