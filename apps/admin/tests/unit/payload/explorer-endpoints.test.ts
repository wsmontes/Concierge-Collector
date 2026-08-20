import { beforeEach, describe, expect, test, vi } from 'vitest'

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

interface SavedViewDoc { _id: string; owner: string; name: string; [key: string]: unknown }

describe('Saved curation views endpoints', () => {
  const store: SavedViewDoc[] = []
  const createCalls: Array<Record<string, unknown>> = []
  let nextId = 1

  beforeEach(() => {
    store.length = 0
    createCalls.length = 0
    nextId = 1
  })

  function endpointFor(method: 'get' | 'post' | 'delete', path: string) {
    return async (pathname: string, init: RequestInit = {}, routeParams: { id?: string } = {}) => {
      const { explorerEndpoints } = await import('../../../src/payload/endpoints/explorer')
      const endpoint = explorerEndpoints().find(({ method: m, path: p }) => m === method && p === path)
      const request = Object.assign(new Request(`https://admin.example.test/api${pathname}`, init), {
        payload: {
          db: {
            collections: {
              'cms-users': {
                findOne: ({ fastapiUserId }: { fastapiUserId: string }) => ({
                  lean: async () => (fastapiUserId === 'admin-1' ? { _id: 'user-1', fastapiUserId } : null),
                }),
              },
              'saved-curation-views': {
                find: () => ({
                  sort: () => ({ lean: async () => store.filter((view) => view.owner === 'user-1') }),
                }),
                create: async (data: Record<string, unknown>) => {
                  const doc = { _id: `view-${nextId}`, ...data }
                  nextId += 1
                  store.push(doc)
                  createCalls.push(data)
                  return { toObject: () => doc }
                },
                deleteOne: async (filter: { _id: string; owner: string }) => {
                  const index = store.findIndex(
                    (view) => view._id === filter._id && view.owner === filter.owner,
                  )
                  if (index === -1) return { deletedCount: 0 }
                  store.splice(index, 1)
                  return { deletedCount: 1 }
                },
              },
            },
          },
        },
        routeParams,
      }) as never
      return endpoint!.handler(request)
    }
  }

  test('GET lists only the views owned by the current actor', async () => {
    store.push({ _id: 'view-1', owner: 'user-1', name: 'Mine', normalizedFilters: { q: 'sushi' } })
    store.push({ _id: 'view-2', owner: 'user-2', name: 'Other', normalizedFilters: {} })

    const response = await endpointFor('get', '/admin/v1/curation-views')('/admin/v1/curation-views')

    expect(response.status).toBe(200)
    const { items } = await response.json() as { items: Array<Record<string, unknown>> }
    expect(items).toEqual([{ id: 'view-1', name: 'Mine', normalizedFilters: { q: 'sushi' }, sort: null, visibleColumns: null, createdAt: null, updatedAt: null }])
  })

  test('POST persists a view owned by the current actor', async () => {
    const response = await endpointFor('post', '/admin/v1/curation-views')('/admin/v1/curation-views', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '  Sushi in SP ',
        normalizedFilters: { q: 'sushi', status: ['active'] },
        sort: { updated_at: 'desc' },
        visibleColumns: ['city', 'status'],
      }),
    })

    expect(response.status).toBe(201)
    const view = await response.json() as Record<string, unknown>
    expect(view.id).toBe('view-1')
    expect(view.name).toBe('Sushi in SP')
    expect(createCalls).toEqual([{
      owner: 'user-1',
      name: 'Sushi in SP',
      normalizedFilters: { q: 'sushi', status: ['active'] },
      sort: { updated_at: 'desc' },
      visibleColumns: ['city', 'status'],
    }])
  })

  test('POST rejects unknown fields and a blank name before persisting', async () => {
    const unknownField = await endpointFor('post', '/admin/v1/curation-views')('/admin/v1/curation-views', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'View', owner: 'user-2', normalizedFilters: {} }),
    })
    expect(unknownField.status).toBe(400)
    expect(createCalls).toHaveLength(0)

    const blankName = await endpointFor('post', '/admin/v1/curation-views')('/admin/v1/curation-views', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    })
    expect(blankName.status).toBe(400)
    expect(createCalls).toHaveLength(0)
  })

  test('DELETE removes only a view owned by the current actor', async () => {
    const mine = 'a'.repeat(24)
    const other = 'b'.repeat(24)
    store.push({ _id: mine, owner: 'user-1', name: 'Mine', normalizedFilters: {} })
    store.push({ _id: other, owner: 'user-2', name: 'Other', normalizedFilters: {} })

    const missing = await endpointFor('delete', '/admin/v1/curation-views/:id')('/admin/v1/curation-views/000000000000000000000000', {}, { id: '000000000000000000000000' })
    expect(missing.status).toBe(404)

    const notOwned = await endpointFor('delete', '/admin/v1/curation-views/:id')('/admin/v1/curation-views/bbbbbbbbbbbbbbbbbbbbbbbb', {}, { id: other })
    expect(notOwned.status).toBe(404)

    const owned = await endpointFor('delete', '/admin/v1/curation-views/:id')('/admin/v1/curation-views/aaaaaaaaaaaaaaaaaaaaaaaa', {}, { id: mine })
    expect(owned.status).toBe(200)
    expect(await owned.json()).toEqual({ id: mine })
    expect(store.map((view) => view._id)).toEqual([other])
  })
})
