import { describe, expect, test, vi } from 'vitest'

const actor = { user_id: 'admin-1' }
const issueCredential = vi.fn()

vi.mock('../../../src/http/with-admin', () => ({
  withAdmin: (handler: (request: Request, actor: typeof actor) => Promise<Response>) => async (request: Request) => {
    try { return await handler(request, actor) }
    catch (error) {
      const known = error as { code?: string; status?: number }
      return Response.json({ error: { code: known.code ?? 'service_unavailable' } }, { status: known.status ?? 503 })
    }
  },
}))

vi.mock('../../../src/applications/credentials', () => ({
  issueCredential,
  revokeCredential: vi.fn(),
}))

vi.mock('../../../src/applications/repository', () => ({
  PayloadCredentialRepository: class { constructor(..._args: unknown[]) {} },
}))

function requestFor(url: string, init: RequestInit & { routeParams?: Record<string, string> } = {}) {
  const request = new Request(url, init)
  return Object.assign(request, {
    routeParams: init.routeParams,
    payload: { db: { collections: { 'consumer-credentials': { findOne: () => ({ lean: async () => null }) } } } },
  })
}

describe('consumer credential endpoints', () => {
  test('returns a secret once with no-store and forwards only valid input', async () => {
    issueCredential.mockResolvedValueOnce({ credential: { id: 'cred-1', prefix: 'a'.repeat(12) }, secretOnce: 'cck_secret' })
    const { applicationEndpoints } = await import('../../../src/payload/endpoints/applications')
    const endpoint = applicationEndpoints().find(({ method, path }) => method === 'post' && path === '/admin/v1/applications/:id/credentials')
    const response = await endpoint!.handler(requestFor('https://admin.example.test/api/admin/v1/applications/0123456789abcdef01234567/credentials', {
      method: 'POST', routeParams: { id: '0123456789abcdef01234567' },
      headers: { 'content-type': 'application/json', 'idempotency-key': 'issue-1', 'x-request-id': 'request-1' },
      body: JSON.stringify({ name: 'Production', scopes: ['collections:read'], expiresAt: null }),
    }) as never)

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ credential: { id: 'cred-1', prefix: 'a'.repeat(12) }, secret_once: 'cck_secret' })
    expect(issueCredential).toHaveBeenCalledWith(expect.objectContaining({ applicationId: '0123456789abcdef01234567', actorId: 'admin-1', idempotencyKey: 'issue-1' }), expect.anything())
  })

  test('rejects an unknown credential field before issuance', async () => {
    const { applicationEndpoints } = await import('../../../src/payload/endpoints/applications')
    const endpoint = applicationEndpoints().find(({ method, path }) => method === 'post' && path === '/admin/v1/applications/:id/credentials')
    const response = await endpoint!.handler(requestFor('https://admin.example.test/api/admin/v1/applications/0123456789abcdef01234567/credentials', {
      method: 'POST', routeParams: { id: '0123456789abcdef01234567' },
      headers: { 'content-type': 'application/json', 'idempotency-key': 'issue-2', 'x-request-id': 'request-2' },
      body: JSON.stringify({ name: 'Production', scopes: ['collections:read'], unexpected: true }),
    }) as never)
    expect(response.status).toBe(400)
  })
})
