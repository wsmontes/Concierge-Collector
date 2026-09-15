import { afterEach, describe, expect, test, vi } from 'vitest'
import { AdminHttpError } from '../../src/http/errors'
// Static on purpose: `vi.mock` below is hoisted by the runner, so this module
// graph already receives the mocked `with-admin`.
import { curatorEndpoints } from '../../src/payload/endpoints/curators'

const actor = {
  authz_revision: 'revision-1', authorized: true, email: 'admin@example.test', name: 'Admin', picture: null,
  role: 'admin' as const, user_id: 'admin-1',
}

/**
 * Mirrors the real wrapper: it proves a session and turns whatever the handler
 * throws into the Admin error response.
 */
vi.mock('../../src/http/with-admin', () => ({
  withAdmin: (handler: (request: Request, currentActor: typeof actor) => Promise<Response>) =>
    async (request: Request) => {
      try {
        return await handler(request, actor)
      } catch (error) {
        const known = error as { code?: string; status?: number }
        return Response.json({ error: { code: known.code ?? 'service_unavailable' } }, {
          status: known.status ?? 503,
        })
      }
    },
}))

const originalEnv = { ...process.env }

const ana = { curator_id: 'ana@example.test', name: 'Ana Beatriz', email: 'ana@example.test' }

afterEach(() => {
  process.env = { ...originalEnv }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function handler() {
  const endpoint = curatorEndpoints().find((entry) => entry.method === 'get')
  if (!endpoint) throw new Error('Missing the curator directory endpoint')
  return endpoint.handler
}

function requestFor(url: string) {
  return Object.assign(new Request(url), { payload: {} }) as never
}

function withBoundaryEnv() {
  process.env.CMS_MONGODB_URL = 'mongodb://localhost:27017'
  process.env.CMS_SERVICE_KEY = 'test-cms-service-key'
  process.env.FASTAPI_BASE_URL = 'http://api.example.test:8000'
  process.env.PAYLOAD_SECRET = 'x'.repeat(32)
  process.env.CMS_PUBLIC_SERVER_URL = 'http://localhost:3000'
}

describe('Curator directory endpoint', () => {
  test('answers the rows the picker offers, from the actor the session proved', async () => {
    const search = vi.fn().mockResolvedValue([ana])
    const endpoint = curatorEndpoints(search).find((entry) => entry.method === 'get')!.handler

    const response = await endpoint(requestFor('https://admin.example.test/api/admin/v1/records/curators?q=ana'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [ana] })
    expect(search).toHaveBeenCalledWith({ query: 'ana', actorId: 'admin-1' })
  })

  test('browses without a term and rejects an over-long query', async () => {
    const search = vi.fn().mockResolvedValue([ana])
    const endpoint = curatorEndpoints(search).find((entry) => entry.method === 'get')!.handler

    const browsed = await endpoint(requestFor('https://admin.example.test/api/admin/v1/records/curators'))
    expect(browsed.status).toBe(200)
    expect(search).toHaveBeenCalledWith({ query: null, actorId: 'admin-1' })
    await expect(browsed.json()).resolves.toEqual({ items: [ana] })

    const tooLong = await endpoint(requestFor(
      `https://admin.example.test/api/admin/v1/records/curators?q=${'a'.repeat(201)}`,
    ))
    expect(tooLong.status).toBe(400)
    await expect(tooLong.json()).resolves.toEqual({ error: { code: 'invalid_request' } })
    expect(search).toHaveBeenCalledTimes(1)
  })

  test('reads the boundary with the service credential and the actor, dropping rows no picker could apply', async () => {
    withBoundaryEnv()
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      items: [ana, { curator_id: '', name: 'Broken row', email: null }, { name: 'No identity' }],
    }))
    vi.stubGlobal('fetch', fetcher)
    const endpoint = curatorEndpoints().find((entry) => entry.method === 'get')!.handler

    const response = await endpoint(requestFor('https://admin.example.test/api/admin/v1/records/curators?q=ana'))

    // The browser never learns the service key: it is added here, server-side.
    expect(fetcher).toHaveBeenCalledWith(
      'http://api.example.test:8000/api/v3/catalog/curators?q=ana',
      { headers: { 'x-cms-service-key': 'test-cms-service-key', 'x-cms-actor-id': 'admin-1' } },
    )
    expect(response.status).toBe(200)
    // A row without an identity is not a curator anyone can be assigned to.
    await expect(response.json()).resolves.toEqual({ items: [ana] })
  })

  test('keeps the boundary refusal instead of answering an empty directory', async () => {
    withBoundaryEnv()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      Response.json({ error: { code: 'authorization_revoked' } }, { status: 403 }),
    ))

    const response = await handler()(requestFor('https://admin.example.test/api/admin/v1/records/curators?q=ana'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: { code: 'authorization_revoked' } })
  })

  test('reports an unreachable boundary as unavailable instead of an empty directory', async () => {
    withBoundaryEnv()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new AdminHttpError(503, 'service_unavailable')))

    const response = await handler()(requestFor('https://admin.example.test/api/admin/v1/records/curators'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: { code: 'service_unavailable' } })
  })
})
