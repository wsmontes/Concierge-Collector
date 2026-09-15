import { describe, expect, test, vi } from 'vitest'
// Static on purpose: `vi.mock` below is hoisted by the runner, so this module
// graph already receives the mocked `with-admin`.
import { explorerEndpoints } from '../../../src/payload/endpoints/explorer'

const actor = {
  authz_revision: 'revision-1', authorized: true, email: 'admin@example.test', name: 'Admin', picture: null,
  role: 'admin' as const, user_id: 'admin-1',
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

function requestFor(url: string, payload: unknown = {}) {
  return Object.assign(new Request(url), { routeParams: undefined, payload })
}

/** Captures the membership query so the tests can pin which rows count as current. */
function membershipModel(rows: Record<string, unknown>[]) {
  const queries: unknown[] = []
  return {
    queries,
    model: {
      find: (query: unknown) => {
        queries.push(query)
        return { select: () => ({ lean: async () => rows }), lean: async () => rows }
      },
    },
  }
}

const LIST_URL = 'https://admin.example.test/api/admin/v1/curations'

function listHandler(adapter: unknown) {
  const endpoint = explorerEndpoints(() => adapter as never).find(
    (entry) => entry.method === 'get' && entry.path === '/admin/v1/curations',
  )
  if (!endpoint) throw new Error('missing list endpoint')
  return endpoint.handler
}

describe('Curations list endpoint', () => {
  test('forwards the chosen sort and the concept facets to the catalog boundary', async () => {
    const search = vi.fn().mockResolvedValue({ items: [], next_cursor: null, total: null })
    const handler = listHandler({ search })

    const response = await handler(requestFor(
      `${LIST_URL}?status=active&sort=updated_at_desc&concept.Mood=Casual&concept.Mood=Lively`,
    ) as never)

    expect(response.status).toBe(200)
    expect(search).toHaveBeenCalledWith({
      actorId: 'admin-1',
      cursor: null,
      filters: {
        status: ['active'],
        concepts: [
          { category: 'Mood', value: 'Casual' },
          { category: 'Mood', value: 'Lively' },
        ],
      },
      limit: 100,
      sort: 'updated_at_desc',
    })
  })

  test('omits the sort entirely when the URL carries none, leaving the boundary default in place', async () => {
    const search = vi.fn().mockResolvedValue({ items: [], next_cursor: null, total: null })
    const handler = listHandler({ search })

    await handler(requestFor(LIST_URL) as never)

    expect(search.mock.calls[0][0]).not.toHaveProperty('sort')
  })

  test('forwards advanced conditions and the unlinked flag to the catalog boundary', async () => {
    const search = vi.fn().mockResolvedValue({ items: [], next_cursor: null, total: null })
    const handler = listHandler({ search })
    const clauses = [
      { field: 'curator_type', op: 'equals', value: 'synthetic' },
      { field: 'sources.audio', op: 'exists' },
    ]

    const response = await handler(requestFor(
      `${LIST_URL}?unlinked=true&${clauses.map((clause) => `where=${encodeURIComponent(JSON.stringify(clause))}`).join('&')}`,
    ) as never)

    expect(response.status).toBe(200)
    expect(search).toHaveBeenCalledWith({
      actorId: 'admin-1',
      cursor: null,
      filters: { unlinked: true, where: clauses },
      limit: 100,
    })
  })

  test('ignores malformed advanced conditions instead of refusing the page', async () => {
    const search = vi.fn().mockResolvedValue({ items: [], next_cursor: null, total: null })
    const handler = listHandler({ search })

    const response = await handler(requestFor(
      `${LIST_URL}?where=not-json&where=${encodeURIComponent('{"field":"city","op":"bogus"}')}`,
    ) as never)

    expect(response.status).toBe(200)
    expect(search.mock.calls[0][0].filters).toEqual({})
  })

  test.each([
    ['/admin/v1/curations?sort=random', 'an unknown sort'],
    ['/admin/v1/curations?concept.=Casual', 'a concept facet without a category'],
    ['/admin/v1/curations?debug=true', 'an unrecognized parameter'],
  ])('refuses %s before reaching the boundary', async (path) => {
    const search = vi.fn()
    const handler = listHandler({ search })

    const response = await handler(requestFor(`https://admin.example.test${path}`) as never)

    expect(response.status).toBe(400)
    expect(search).not.toHaveBeenCalled()
  })

  test('counts only current memberships per row, in one query for the whole page', async () => {
    const search = vi.fn().mockResolvedValue({
      items: [
        { curation_id: 'cur_1', restaurant_name: 'Ritz' },
        { curation_id: 'cur_2', restaurant_name: 'D.O.M.' },
      ],
      next_cursor: null,
      total: 2,
    })
    const memberships = membershipModel([
      { curationId: 'cur_1' },
      { curationId: 'cur_1' },
    ])
    const handler = listHandler({ search })

    const response = await handler(requestFor(LIST_URL, {
      db: { collections: { 'collection-memberships': memberships.model } },
    }) as never)

    expect(memberships.queries).toHaveLength(1)
    expect(memberships.queries[0]).toEqual({
      curationId: { $in: ['cur_1', 'cur_2'] },
      removedInVersion: null,
    })
    const body = await response.json() as { items: Array<Record<string, unknown>> }
    expect(body.items.map((item) => item.collections_count)).toEqual([2, 0])
    expect(body.items[0].restaurant_name).toBe('Ritz')
  })

  test('does not query memberships for an empty page', async () => {
    const search = vi.fn().mockResolvedValue({ items: [], next_cursor: null, total: 0 })
    const memberships = membershipModel([])
    const handler = listHandler({ search })

    await handler(requestFor(LIST_URL, {
      db: { collections: { 'collection-memberships': memberships.model } },
    }) as never)

    expect(memberships.queries).toHaveLength(0)
  })
})
