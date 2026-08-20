import { describe, expect, test, vi } from 'vitest'

const actor = {
  authz_revision: 'revision-1', authorized: true, email: 'admin@example.test', name: 'Admin', picture: null,
  role: 'admin' as const, user_id: 'admin-1',
}

vi.mock('../../../src/http/with-admin', () => ({
  withAdmin: (handler: (request: Request, currentActor: typeof actor) => Promise<Response>) =>
    (request: Request) => handler(request, actor),
}))

describe('Explorer read endpoint', () => {
  test('forwards allowlisted filters and the live actor to the catalog adapter', async () => {
    const { explorerEndpoints } = await import('../../../src/payload/endpoints/explorer')
    const search = vi.fn().mockResolvedValue({ items: [], next_cursor: null, total: null })
    const endpoint = explorerEndpoints(() => ({ search }))
      .find(({ method, path }) => method === 'get' && path === '/admin/v1/curations')

    const response = await endpoint!.handler(new Request(
      'https://admin.example.test/api/admin/v1/curations?q=%20Sushi%20&status=active&status=draft&limit=50',
    ) as never)

    expect(response.status).toBe(200)
    expect(search).toHaveBeenCalledWith({
      actorId: 'admin-1', cursor: null, filters: { q: 'sushi', status: ['active', 'draft'] }, limit: 50,
    })
  })

  test('rejects unrecognized query fields before calling FastAPI', async () => {
    const { explorerEndpoints } = await import('../../../src/payload/endpoints/explorer')
    const search = vi.fn()
    const endpoint = explorerEndpoints(() => ({ search }))
      .find(({ method, path }) => method === 'get' && path === '/admin/v1/curations')

    const response = await endpoint!.handler(new Request('https://admin.example.test/api/admin/v1/curations?debug=true') as never)

    expect(response.status).toBe(400)
    expect(search).not.toHaveBeenCalled()
  })
})
