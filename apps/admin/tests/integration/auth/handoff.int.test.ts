import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Payload } from 'payload'
import { consumePersistedLoginState, createLoginState, isSafeAdminReturnTo } from '../../../src/auth/cms-session'
import { completeCmsHandoff } from '../../../src/auth/cms-handoff'

const skipMongoIntegration = process.env.CMS_SKIP_MONGO_INTEGRATION === '1'
const mongoIntegrationSuite = skipMongoIntegration ? describe.skip : describe

let payload: Payload

function requireIntegrationDatabase(): void {
  const mongoUrl = process.env.CMS_MONGODB_URL?.trim()
  const databaseName = process.env.CMS_MONGODB_DB_NAME?.trim()

  if (!mongoUrl || !databaseName) {
    throw new Error(
      'Mongo integration requires CMS_MONGODB_URL and CMS_MONGODB_DB_NAME ending in -test. ' +
        'Set CMS_SKIP_MONGO_INTEGRATION=1 only to explicitly skip this suite.',
    )
  }

  if (!databaseName.endsWith('-test')) {
    throw new Error(`Refusing CMS integration database without -test suffix: ${databaseName}`)
  }
}

describe('CMS handoff', () => {
  test('persists only a hash and a ten-minute expiry for a server-controlled admin return path', async () => {
    const created: unknown[] = []
    const payload = {
      create: async ({ data }: { data: unknown }) => {
        created.push(data)
        return data
      },
    }

    const state = await createLoginState(payload as never, '/admin/collections')
    const record = created[0] as { stateHash: string; expiresAt: string; returnTo: string }

    expect(record).toMatchObject({ returnTo: '/admin/collections' })
    expect(record.stateHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(record)).not.toContain(state)
    expect(new Date(record.expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000)
  })

  test.each(['/admin', '/admin/collections', '/admin/collections?draft=1'])(
    'accepts an internal admin return path: %s',
    (value) => expect(isSafeAdminReturnTo(value)).toBe(true),
  )

  test.each(['/', '/collector', 'https://attacker.test/admin', '//attacker.test/admin', '/adminish']) (
    'rejects a tampered return path: %s',
    (value) => expect(isSafeAdminReturnTo(value)).toBe(false),
  )

  test('rejects a replayed or expired state before it exchanges the FastAPI code', async () => {
    const exchange = async () => ({
      authz_revision: 'revision', authorized: true, email: 'admin@example.com', name: 'Admin', picture: null,
      role: 'admin' as const, user_id: 'user-1',
    })
    const once = { calls: 0 }
    const deps = {
      consumeLoginState: async () => {
        once.calls += 1
        return once.calls === 1 ? { returnTo: '/admin' } : null
      },
      createSession: async () => 'session',
      exchange,
      mirrorUser: async () => ({ id: 'cms-user-1' }),
    }

    await expect(completeCmsHandoff({} as never, { code: 'code', state: 'state', targetOrigin: 'https://admin.test' }, deps))
      .resolves.toMatchObject({ returnTo: '/admin', session: 'session' })
    await expect(completeCmsHandoff({} as never, { code: 'replay', state: 'state', targetOrigin: 'https://admin.test' }, deps))
      .rejects.toThrow('Invalid CMS login state')
  })

  test('rejects a role downgrade returned during code exchange', async () => {
    await expect(completeCmsHandoff({} as never, { code: 'code', state: 'state', targetOrigin: 'https://admin.test' }, {
      consumeLoginState: async () => ({ returnTo: '/admin' }),
      createSession: async () => 'session',
      exchange: async () => ({
        authz_revision: 'revision', authorized: true, email: 'curator@example.com', name: 'Curator', picture: null,
        role: 'curator' as const, user_id: 'user-2',
      }),
      mirrorUser: async () => ({ id: 'cms-user-2' }),
    })).rejects.toThrow('CMS admin access is required')
  })
})

mongoIntegrationSuite('CMS persisted login-state CAS', () => {
  beforeAll(async () => {
    requireIntegrationDatabase()
    process.env.CMS_SERVICE_KEY ??= 'integration-cms-service-key'
    process.env.FASTAPI_BASE_URL ??= 'http://localhost:8000'
    process.env.PAYLOAD_SECRET ??= 'integration-payload-secret-with-at-least-32-characters'
    process.env.CMS_PUBLIC_SERVER_URL ??= 'http://localhost:3000'

    const [{ getPayload }, { default: config }] = await Promise.all([
      import('payload'),
      import('../../../payload.config'),
    ])
    payload = await getPayload({ config })
  })

  afterAll(async () => {
    await payload?.destroy()
  })

  test('allows exactly one concurrent callback to consume a persisted login state', async () => {
    const rawState = await createLoginState(payload, '/admin/collections')
    const results = await Promise.allSettled([
      consumePersistedLoginState(payload, rawState, rawState),
      consumePersistedLoginState(payload, rawState, rawState),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })
})
