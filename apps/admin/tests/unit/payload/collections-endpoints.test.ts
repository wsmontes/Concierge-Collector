import { describe, expect, test, vi } from 'vitest'

const actor = {
  authz_revision: 'revision-1',
  authorized: true,
  email: 'admin@example.test',
  name: 'Admin',
  picture: null,
  role: 'admin' as const,
  user_id: 'admin-1',
}

vi.mock('../../../src/http/with-admin', () => ({
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

function requestFor(url: string, init: RequestInit & { routeParams?: Record<string, string> } = {}) {
  const request = new Request(url, init)
  return Object.assign(request, { routeParams: init.routeParams, payload: {} })
}

describe('Collection lifecycle endpoints', () => {
  test('rejects malformed Collection IDs before reaching the repository', async () => {
    const { collectionEndpoints } = await import('../../../src/payload/endpoints/collections')
    const repository = { getCollection: vi.fn() }
    const endpoint = collectionEndpoints(() => repository as never)
      .find(({ method, path }) => method === 'get' && path === '/admin/v1/collections/:id')

    const response = await endpoint!.handler(requestFor('https://admin.example.test/api/admin/v1/collections/not-an-object-id', {
      routeParams: { id: 'not-an-object-id' },
    }) as never)

    expect(response.status).toBe(404)
    expect(repository.getCollection).not.toHaveBeenCalled()
  })

  test('rejects malformed create metadata before creating a command', async () => {
    const { collectionEndpoints } = await import('../../../src/payload/endpoints/collections')
    const repository = { createCollection: vi.fn() }
    const endpoint = collectionEndpoints(() => repository as never)
      .find(({ method, path }) => method === 'post' && path === '/admin/v1/collections')

    const response = await endpoint!.handler(requestFor('https://admin.example.test/api/admin/v1/collections', {
      body: JSON.stringify({ slug: '---', title: '   ' }),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'key-1',
        'x-request-id': 'request-1',
      },
      method: 'POST',
    }) as never)

    expect(response.status).toBe(400)
    expect(repository.createCollection).not.toHaveBeenCalled()
  })
})
