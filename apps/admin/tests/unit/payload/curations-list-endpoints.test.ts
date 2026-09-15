import { describe, expect, test, vi } from 'vitest'
import { AdminHttpError } from '../../../src/http/errors'
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

function listHandler(adapter: unknown, rowsAdapter: unknown = { curationSummaries: vi.fn() }) {
  const endpoint = explorerEndpoints(() => adapter as never, () => rowsAdapter as never).find(
    (entry) => entry.method === 'get' && entry.path === '/admin/v1/curations',
  )
  if (!endpoint) throw new Error('missing list endpoint')
  return endpoint.handler
}

/** The membership ledger read the view mode performs: one `distinct` over live rows. */
function ledgerModel(ids: readonly string[]) {
  const calls: unknown[] = []
  return {
    calls,
    model: {
      distinct: async (field: string, query: unknown) => {
        calls.push({ field, query })
        return [...ids]
      },
    },
  }
}

function ledgerPayload(ids: readonly string[]) {
  const ledger = ledgerModel(ids)
  return {
    ledger,
    payload: { db: { collections: { 'collection-memberships': ledger.model } } },
  }
}

/** A frozen scan stand-in: it applies the exclusion the boundary applies, per page. */
function scanBoundary(ids: readonly string[]) {
  const started: unknown[] = []
  const pages: unknown[] = []
  let remaining: string[] = []
  return {
    pages,
    started,
    startScan: vi.fn(async (input: { excludeCurationIds: readonly string[] }) => {
      started.push(input)
      remaining = ids.filter((id) => !input.excludeCurationIds.includes(id))
      return 'scan-token'
    }),
    scanPage: vi.fn(async (input: { limit: number }) => {
      pages.push(input)
      const page = remaining.slice(0, input.limit)
      remaining = remaining.slice(input.limit)
      return { ids: page, nextCursor: remaining.length > 0 ? 'more' : null }
    }),
  }
}

function summaryRows(ids: string[]) {
  return ids.map((curation_id) => ({ catalog_sequence: 1, curation_id, status: 'active', has_transcript: false }))
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

  test('composes the filtered page from the scan, the ledger exclusion and the summaries', async () => {
    const catalog = scanBoundary(['cur-1', 'cur-2', 'cur-3', 'cur-4', 'cur-5'])
    const search = vi.fn()
    const curationSummaries = vi.fn(async (ids: string[]) => ({ items: summaryRows(ids) }))
    const { ledger, payload } = ledgerPayload(['cur-4', 'cur-2'])
    const handler = listHandler({ search, ...catalog }, { curationSummaries })

    const response = await handler(requestFor(
      `${LIST_URL}?without_collections=true&status=active&limit=2&sort=updated_at_desc`,
      payload,
    ) as never)

    expect(response.status).toBe(200)
    // The view mode never reaches the boundary: it receives the ledger exclusion instead.
    expect(search).not.toHaveBeenCalled()
    expect(catalog.started[0]).toEqual({
      actorId: 'admin-1',
      excludeCurationIds: ['cur-2', 'cur-4'],
      filters: { status: ['active'] },
      sort: 'updated_at_desc',
    })
    expect(ledger.calls[0]).toEqual({ field: 'curationId', query: { removedInVersion: null } })

    const firstPage = await response.json() as { items: Array<Record<string, unknown>>; next_cursor: string | null; total: null }
    expect(firstPage.items.map((item) => item.curation_id)).toEqual(['cur-1', 'cur-3'])
    expect(firstPage.items.every((item) => item.collections_count === 0)).toBe(true)
    expect(firstPage.total).toBeNull()
    expect(curationSummaries).toHaveBeenCalledWith(['cur-1', 'cur-3'], 'admin-1')

    const second = await handler(requestFor(
      `${LIST_URL}?without_collections=true&status=active&limit=2&cursor=${encodeURIComponent(firstPage.next_cursor!)}`,
      payload,
    ) as never)

    const secondPage = await second.json() as { items: Array<Record<string, unknown>>; next_cursor: string | null }
    expect(secondPage.items.map((item) => item.curation_id)).toEqual(['cur-5'])
    expect(secondPage.next_cursor).toBeNull()
  })

  test('serves the empty state without asking the boundary for rows', async () => {
    const catalog = scanBoundary(['cur-1'])
    const curationSummaries = vi.fn()
    const { payload } = ledgerPayload(['cur-1'])
    const handler = listHandler({ search: vi.fn(), ...catalog }, { curationSummaries })

    const response = await handler(requestFor(`${LIST_URL}?without_collections=true`, payload) as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ items: [], next_cursor: null, total: null })
    expect(curationSummaries).not.toHaveBeenCalled()
  })

  test('propagates a boundary refusal instead of serving an unfiltered page', async () => {
    const startScan = vi.fn(async () => { throw new AdminHttpError(403, 'authorization_revoked') })
    const curationSummaries = vi.fn()
    const { payload } = ledgerPayload(['cur-1'])
    const handler = listHandler({ search: vi.fn(), startScan, scanPage: vi.fn() }, { curationSummaries })

    const response = await handler(requestFor(`${LIST_URL}?without_collections=true`, payload) as never)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: { code: 'authorization_revoked' } })
    expect(curationSummaries).not.toHaveBeenCalled()
  })

  test('refuses the view when the ledger is larger than the boundary accepts', async () => {
    const catalog = scanBoundary([])
    const ids = Array.from({ length: 10_001 }, (_, index) => `cur-${index}`)
    const { payload } = ledgerPayload(ids)
    const handler = listHandler({ search: vi.fn(), ...catalog }, { curationSummaries: vi.fn() })

    const response = await handler(requestFor(`${LIST_URL}?without_collections=true`, payload) as never)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: { code: 'service_unavailable' } })
    expect(catalog.started).toHaveLength(0)
  })
})
