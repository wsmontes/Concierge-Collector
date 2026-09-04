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

function requestFor(
  url: string,
  init: RequestInit & { routeParams?: Record<string, string>; payload?: unknown } = {},
) {
  const { routeParams, payload, ...requestInit } = init
  const request = new Request(url, requestInit)
  return Object.assign(request, { routeParams, payload: payload ?? {} })
}

describe('Collection lifecycle endpoints', () => {
  test('management list includes archived Collections through a bounded cursor page', async () => {
    const { collectionEndpoints } = await import('../../../src/payload/endpoints/collections')
    const rows = [{
      _id: '507f1f77bcf86cd799439011',
      slug: 'victoria',
      title: 'Victoria',
      description: null,
      lifecycle: 'published',
      currentPublishedVersion: 2,
      draftRevision: 7,
      draftState: 'dirty',
      publishedSelectedCount: 8,
      draftSelectedCount: 9,
      revision: 12,
    }, {
      _id: '507f1f77bcf86cd799439012',
      slug: 'old',
      title: 'Old',
      description: 'Archived Collection',
      lifecycle: 'archived',
      currentPublishedVersion: 1,
      draftRevision: 0,
      draftState: 'clean',
      publishedSelectedCount: 4,
      draftSelectedCount: 4,
      revision: 5,
    }]
    const lean = vi.fn().mockResolvedValue(rows)
    const limit = vi.fn().mockReturnValue({ lean })
    const sort = vi.fn().mockReturnValue({ limit })
    const find = vi.fn().mockReturnValue({ sort })
    const endpoint = collectionEndpoints()
      .find(({ method, path }) => method === 'get' && path === '/admin/v1/collections')

    const response = await endpoint!.handler(requestFor(
      'https://admin.example.test/api/admin/v1/collections',
      { payload: { db: { collections: { collections: { find } } } } },
    ) as never)

    expect(response.status).toBe(200)
    expect(find).toHaveBeenCalledWith({})
    expect(sort).toHaveBeenCalledWith({ title: 1, _id: 1 })
    expect(limit).toHaveBeenCalledWith(101)
    expect(await response.json()).toEqual({ items: [{
      id: '507f1f77bcf86cd799439011',
      slug: 'victoria',
      title: 'Victoria',
      description: null,
      lifecycle: 'published',
      currentPublishedVersion: 2,
      draftRevision: 7,
      draftState: 'dirty',
      publishedSelectedCount: 8,
      draftSelectedCount: 9,
      revision: 12,
    }, {
      id: '507f1f77bcf86cd799439012',
      slug: 'old',
      title: 'Old',
      description: 'Archived Collection',
      lifecycle: 'archived',
      currentPublishedVersion: 1,
      draftRevision: 0,
      draftState: 'clean',
      publishedSelectedCount: 4,
      draftSelectedCount: 4,
      revision: 5,
    }], nextCursor: null })
  })

  test('management list applies a validated title/id cursor', async () => {
    const { collectionEndpoints } = await import('../../../src/payload/endpoints/collections')
    const cursor = Buffer.from(JSON.stringify({ title: 'Old', id: '507f1f77bcf86cd799439012' })).toString('base64url')
    const lean = vi.fn().mockResolvedValue([])
    const limit = vi.fn().mockReturnValue({ lean })
    const sort = vi.fn().mockReturnValue({ limit })
    const find = vi.fn().mockReturnValue({ sort })
    const endpoint = collectionEndpoints().find(({ method, path }) => method === 'get' && path === '/admin/v1/collections')!

    const response = await endpoint.handler(requestFor(
      `https://admin.example.test/api/admin/v1/collections?cursor=${encodeURIComponent(cursor)}`,
      { payload: { db: { collections: { collections: { find } } } } },
    ) as never)

    expect(response.status).toBe(200)
    expect(find).toHaveBeenCalledWith({
      $or: [
        { title: { $gt: 'Old' } },
        { title: 'Old', _id: { $gt: '507f1f77bcf86cd799439012' } },
      ],
    })
  })

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