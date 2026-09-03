import { beforeEach, describe, expect, test, vi } from 'vitest'

const actor = {
  authz_revision: 'revision-1', authorized: true, email: 'admin@example.test', name: 'Admin', picture: null,
  role: 'admin' as const, user_id: 'admin-1',
}

const rotateCredential = vi.fn()

vi.mock('../../../src/http/with-admin', () => ({
  withAdmin: (handler: (request: Request, currentActor: typeof actor) => Promise<Response>) =>
    (request: Request) => handler(request, actor),
}))

vi.mock('../../../src/applications/credentials', () => ({
  issueCredential: vi.fn(),
  revokeCredential: vi.fn(),
  rotateCredential,
}))

vi.mock('../../../src/applications/repository', () => ({
  PayloadCredentialRepository: class {},
}))

function requestFor(model: Record<string, unknown>) {
  return Object.assign(new Request('https://admin.example.test/api/admin/v1/credentials/65f000000000000000000001/rotate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'shared-key',
      'x-request-id': 'request-1',
    },
    body: JSON.stringify({ overlapUntil: '2026-09-03T12:00:00.000Z' }),
  }), {
    routeParams: { id: '65f000000000000000000001' },
    payload: { db: { collections: { 'consumer-credentials': model } } },
  })
}

describe('credential endpoints', () => {
  beforeEach(() => {
    rotateCredential.mockReset().mockResolvedValue({
      credential: { id: '65f000000000000000000099', applicationId: 'app-a', prefix: 'abc123' },
      secretOnce: 'cck_once',
    })
  })

  test('rotate scopes idempotency replay detection to the source Application', async () => {
    const queries: Record<string, unknown>[] = []
    const model = {
      findOne(query: Record<string, unknown>) {
        queries.push(query)
        const value = '_id' in query
          ? { _id: '65f000000000000000000001', applicationId: 'app-a' }
          : null
        return { lean: async () => value }
      },
    }
    const { credentialEndpoints } = await import('../../../src/payload/endpoints/credentials')
    const endpoint = credentialEndpoints().find(({ method, path }) => method === 'post' && path === '/admin/v1/credentials/:id/rotate')!

    const response = await endpoint.handler(requestFor(model) as never)

    expect(response.status).toBe(201)
    expect(queries).toEqual([
      { _id: '65f000000000000000000001' },
      { applicationId: 'app-a', issueIdempotencyKey: 'shared-key' },
    ])
    expect(rotateCredential).toHaveBeenCalledTimes(1)
  })

  test('rotate still blocks a consumed idempotency key inside the same Application', async () => {
    const model = {
      findOne(query: Record<string, unknown>) {
        const value = '_id' in query
          ? { _id: '65f000000000000000000001', applicationId: 'app-a' }
          : { _id: 'already-issued', applicationId: 'app-a', issueIdempotencyKey: 'shared-key' }
        return { lean: async () => value }
      },
    }
    const { credentialEndpoints } = await import('../../../src/payload/endpoints/credentials')
    const endpoint = credentialEndpoints().find(({ method, path }) => method === 'post' && path === '/admin/v1/credentials/:id/rotate')!

    const response = await endpoint.handler(requestFor(model) as never)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: 'unavailable_confirmation_required' } })
    expect(rotateCredential).not.toHaveBeenCalled()
  })
})
