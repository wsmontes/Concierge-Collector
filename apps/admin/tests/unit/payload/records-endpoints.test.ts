import { describe, expect, test, vi } from 'vitest'
import { AdminHttpError } from '../../../src/http/errors'
// Static on purpose: `vi.mock` below is hoisted by the runner, so this module
// graph already receives the mocked `with-admin`.
import { recordEndpoints } from '../../../src/payload/endpoints/records'

const actor = {
  authz_revision: 'revision-1', authorized: true, email: 'admin@example.test', name: 'Admin', picture: null,
  role: 'admin' as const, user_id: 'admin-1',
}

/**
 * Mirrors the real wrapper: it proves a session and turns whatever the handler
 * throws into the Admin error response. The handlers below deliberately let
 * `AdminHttpError` escape, exactly like `collection-reads`.
 */
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

interface ModelRows {
  memberships?: Record<string, unknown>[]
  collections?: Record<string, unknown>[]
}

/**
 * Minimal stand-in for the CMS models this endpoint joins and searches over.
 * The chainable query object mirrors the two access shapes in use —
 * `find().lean()` and `find().select().limit().lean()` — and records the
 * Collection filters so a test can prove how the query was built.
 */
function payloadFor({ memberships = [], collections = [] }: ModelRows = {}) {
  const collectionFinds: unknown[] = []
  const membershipFinds: unknown[] = []
  const model = (rows: Record<string, unknown>[], onFind?: (filter: unknown) => void) => {
    const query = { lean: async () => rows, limit: () => query, select: () => query }
    return {
      find: (filter?: unknown) => {
        onFind?.(filter)
        return query
      },
    }
  }
  return {
    db: {
      collections: {
        'collection-memberships': model(memberships, (filter) => membershipFinds.push(filter)),
        collections: model(collections, (filter) => collectionFinds.push(filter)),
      },
    },
    collectionFinds,
    membershipFinds,
  }
}

function requestFor(
  url: string,
  init: RequestInit & { routeParams?: Record<string, string>; payload?: unknown } = {},
) {
  const { routeParams, payload, ...requestInit } = init
  const request = new Request(url, requestInit)
  return Object.assign(request, { routeParams, payload: payload ?? {} })
}

async function endpointFor(method: 'get' | 'patch', path: string) {
  const endpoint = recordEndpoints().find((entry) => entry.method === method && entry.path === path)
  if (!endpoint) throw new Error(`Missing endpoint ${method} ${path}`)
  return endpoint.handler
}

const CURATION_URL = 'https://admin.example.test/api/admin/v1/records/curations/cur_1'
const ENTITY_URL = 'https://admin.example.test/api/admin/v1/records/entities/rest_1'

describe('Curation record endpoint', () => {
  test('returns the complete stored document with the Collections that hold it', async () => {
    const curationRecord = vi.fn().mockResolvedValue({ curation_id: 'cur_1', notes: { private: 'anniversary' } })
    const handler = recordEndpoints(() => ({ curationRecord }) as never).find(
      (entry) => entry.method === 'get' && entry.path === '/admin/v1/records/curations/:id',
    )!.handler

    const response = await handler(requestFor(CURATION_URL, {
      routeParams: { id: 'cur_1' },
      payload: payloadFor({
        memberships: [{ curationId: 'cur_1', collectionId: 'col_1' }, { curationId: 'cur_1', collectionId: 'gone' }],
        collections: [{ _id: 'col_1', slug: 'victoria', title: 'Victoria', currentPublishedVersion: 3 }],
      }),
    }) as never)

    expect(response.status).toBe(200)
    expect(curationRecord).toHaveBeenCalledWith('cur_1', 'admin-1')
    await expect(response.json()).resolves.toEqual({
      record: { curation_id: 'cur_1', notes: { private: 'anniversary' } },
      // `gone` has a current membership row but no Collection document: it is
      // dropped rather than rendered as a nameless link.
      collections: [{ collection_id: 'col_1', slug: 'victoria', title: 'Victoria', current_published_version: 3 }],
    })
  })

  test('surfaces a missing record as 404 and never leaks the boundary error', async () => {
    const curationRecord = vi.fn().mockRejectedValue(new AdminHttpError(404, 'not_found'))
    const handler = recordEndpoints(() => ({ curationRecord }) as never).find(
      (entry) => entry.method === 'get' && entry.path === '/admin/v1/records/curations/:id',
    )!.handler

    const response = await handler(requestFor(CURATION_URL, { routeParams: { id: 'cur_1' } }) as never)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: { code: 'not_found' } })
  })

  test('writes the edited roots with the actor the session proved and the opened version', async () => {
    const saveCuration = vi.fn().mockResolvedValue({ curation_id: 'cur_1', notes: { public: 'Edited' } })
    const handler = recordEndpoints(() => ({ saveCuration }) as never).find(
      (entry) => entry.method === 'patch' && entry.path === '/admin/v1/records/curations/:id',
    )!.handler

    const response = await handler(requestFor(CURATION_URL, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updates: { notes: { public: 'Edited' } }, expectedVersion: 7 }),
      routeParams: { id: 'cur_1' },
    }) as never)

    expect(response.status).toBe(200)
    expect(saveCuration).toHaveBeenCalledWith({
      actorId: 'admin-1',
      role: 'admin',
      recordId: 'cur_1',
      updates: { notes: { public: 'Edited' } },
      expectedVersion: 7,
    })
    await expect(response.json()).resolves.toEqual({ record: { curation_id: 'cur_1', notes: { public: 'Edited' } } })
  })

  test.each([
    ['an empty update set', { updates: {}, expectedVersion: 7 }],
    ['a missing version', { updates: { status: 'active' } }],
    ['a non-integer version', { updates: { status: 'active' }, expectedVersion: 1.5 }],
    ['an array update', { updates: ['status'], expectedVersion: 7 }],
  ])('refuses %s before reaching the boundary', async (_label, body) => {
    const saveCuration = vi.fn()
    const handler = recordEndpoints(() => ({ saveCuration }) as never).find(
      (entry) => entry.method === 'patch' && entry.path === '/admin/v1/records/curations/:id',
    )!.handler

    const response = await handler(requestFor(CURATION_URL, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      routeParams: { id: 'cur_1' },
    }) as never)

    expect(response.status).toBe(400)
    expect(saveCuration).not.toHaveBeenCalled()
  })

  test('reports a lost optimistic lock as 409 so the editor can offer Reload', async () => {
    const saveCuration = vi.fn().mockRejectedValue(new AdminHttpError(409, 'conflict'))
    const handler = recordEndpoints(() => ({ saveCuration }) as never).find(
      (entry) => entry.method === 'patch' && entry.path === '/admin/v1/records/curations/:id',
    )!.handler

    const response = await handler(requestFor(CURATION_URL, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updates: { status: 'active' }, expectedVersion: 3 }),
      routeParams: { id: 'cur_1' },
    }) as never)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: { code: 'conflict' } })
  })
})

describe('Entity record endpoints', () => {
  test('maps the list query onto the boundary input the adapter expects', async () => {
    const entityPage = vi.fn().mockResolvedValue({ items: [{ id: 'rest_1' }], next_cursor: null, total: 1 })
    const handler = recordEndpoints(() => ({ entityPage }) as never).find(
      (entry) => entry.method === 'get' && entry.path === '/admin/v1/records/entities',
    )!.handler

    const response = await handler(requestFor(
      'https://admin.example.test/api/admin/v1/records/entities?q=ritz&type=restaurant&status=active&cursor=rest_0&limit=25',
    ) as never)

    expect(response.status).toBe(200)
    expect(entityPage).toHaveBeenCalledWith({
      actorId: 'admin-1',
      query: 'ritz',
      type: 'restaurant',
      status: 'active',
      afterId: 'rest_0',
      limit: 25,
    })
    // The boundary reported no Curation ids, so membership is unknown — `null`,
    // which is not the same answer as zero.
    await expect(response.json()).resolves.toEqual({
      items: [{ id: 'rest_1', collections_count: null }],
      next_cursor: null,
      total: 1,
    })
  })

  test('counts the Collections holding each Entity with one membership read for the page', async () => {
    const entityPage = vi.fn().mockResolvedValue({
      items: [
        { id: 'rest_1', curation_ids: ['cur_1', 'cur_2'] },
        { id: 'rest_2', curation_ids: [] },
      ],
      next_cursor: null,
      total: 2,
    })
    const handler = recordEndpoints(() => ({ entityPage }) as never).find(
      (entry) => entry.method === 'get' && entry.path === '/admin/v1/records/entities',
    )!.handler

    const payload = payloadFor({
      memberships: [
        // Two Collections hold `rest_1`, through two different Curations.
        { curationId: 'cur_1', collectionId: 'col_1' },
        { curationId: 'cur_1', collectionId: 'col_2' },
        { curationId: 'cur_2', collectionId: 'col_1' },
        // Neither of these belongs to the page's Curations: one repeats a
        // Collection already counted, the other is another Entity's Curation.
        { curationId: 'cur_2', collectionId: 'col_1' },
        { curationId: 'cur_9', collectionId: 'col_3' },
      ],
    })
    const response = await handler(requestFor(
      'https://admin.example.test/api/admin/v1/records/entities',
      { payload },
    ) as never)

    expect(response.status).toBe(200)
    // ONE ledger read for the whole page, filtered to the page's Curation ids.
    expect(payload.membershipFinds).toEqual([
      { curationId: { $in: ['cur_1', 'cur_2'] }, removedInVersion: null },
    ])
    await expect(response.json()).resolves.toEqual({
      items: [
        { id: 'rest_1', collections_count: 2 },
        // The boundary reported an empty list: a known zero, not unknown.
        { id: 'rest_2', collections_count: 0 },
      ],
      next_cursor: null,
      total: 2,
    })
  })

  test('the page’s Curation ids are a server-side join input and never reach the browser', async () => {
    const entityPage = vi.fn().mockResolvedValue({
      items: [{ id: 'rest_1', curation_ids: ['cur_1'] }],
      next_cursor: null,
      total: 1,
    })
    const handler = recordEndpoints(() => ({ entityPage }) as never).find(
      (entry) => entry.method === 'get' && entry.path === '/admin/v1/records/entities',
    )!.handler

    const response = await handler(requestFor(
      'https://admin.example.test/api/admin/v1/records/entities',
      { payload: payloadFor({ memberships: [{ curationId: 'cur_1', collectionId: 'col_1' }] }) },
    ) as never)

    const body = await response.json() as { items: Record<string, unknown>[] }
    expect(body.items[0]).toEqual({ id: 'rest_1', collections_count: 1 })
    expect('curation_ids' in body.items[0]).toBe(false)
  })

  test.each([
    ['/admin/v1/records/entities?limit=500', 'an oversized page'],
    ['/admin/v1/records/entities?q=%20', 'a blank query'],
  ])('applies the boundary default for %s', async (url) => {
    const entityPage = vi.fn().mockResolvedValue({ items: [], next_cursor: null, total: null })
    const handler = recordEndpoints(() => ({ entityPage }) as never).find(
      (entry) => entry.method === 'get' && entry.path === '/admin/v1/records/entities',
    )!.handler

    const response = await handler(requestFor(`https://admin.example.test${url}`) as never)

    if (url.includes('limit=500')) {
      expect(response.status).toBe(400)
      expect(entityPage).not.toHaveBeenCalled()
      return
    }
    expect(response.status).toBe(200)
    expect(entityPage).toHaveBeenCalledWith(expect.objectContaining({ query: null }))
  })

  test('returns the Curations attached to an Entity with its own page size', async () => {
    const entityCurations = vi.fn().mockResolvedValue({ items: [{ curation_id: 'cur_1' }], total: 1 })
    const handler = recordEndpoints(() => ({ entityCurations }) as never).find(
      (entry) => entry.method === 'get' && entry.path === '/admin/v1/records/entities/:id/curations',
    )!.handler

    const response = await handler(requestFor(
      'https://admin.example.test/api/admin/v1/records/entities/rest_1/curations?limit=10',
      { routeParams: { id: 'rest_1' } },
    ) as never)

    expect(entityCurations).toHaveBeenCalledWith('rest_1', 'admin-1', 10)
    await expect(response.json()).resolves.toEqual({ items: [{ curation_id: 'cur_1' }], total: 1 })
  })

  test('saves an Entity through the same lock contract as a Curation', async () => {
    const saveEntity = vi.fn().mockResolvedValue({ entity_id: 'rest_1', name: 'Ritz' })
    const handler = recordEndpoints(() => ({ saveEntity }) as never).find(
      (entry) => entry.method === 'patch' && entry.path === '/admin/v1/records/entities/:id',
    )!.handler

    const response = await handler(requestFor(ENTITY_URL, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updates: { name: 'Ritz' }, expectedVersion: 2 }),
      routeParams: { id: 'rest_1' },
    }) as never)

    expect(response.status).toBe(200)
    expect(saveEntity).toHaveBeenCalledWith({
      actorId: 'admin-1',
      role: 'admin',
      recordId: 'rest_1',
      updates: { name: 'Ritz' },
      expectedVersion: 2,
    })
  })
})

describe('Global search endpoint', () => {
  test('answers with Curations, Entities and CMS Collections for one query', async () => {
    const search = vi.fn().mockResolvedValue({ items: [{ curation_id: 'cur_1' }], next_cursor: null, total: 1 })
    // The boundary row carries the join input; the palette response must not.
    const entityPage = vi.fn().mockResolvedValue({
      items: [{ id: 'rest_1', curation_ids: ['cur_1'] }],
      next_cursor: null,
      total: 1,
    })
    const handler = recordEndpoints(
      () => ({ entityPage }) as never,
      () => ({ search }) as never,
    ).find((entry) => entry.method === 'get' && entry.path === '/admin/v1/records/search')!.handler

    const response = await handler(requestFor(
      'https://admin.example.test/api/admin/v1/records/search?q=ritz&limit=5',
      {
        payload: payloadFor({
          collections: [
            { _id: 'col_1', slug: 'victoria', title: 'Victoria', lifecycle: 'published', draftSelectedCount: 3 },
            { _id: 'col_2', slug: 'ritz', title: 'Ritz picks', lifecycle: 'draft', draftSelectedCount: 0 },
          ],
        }),
      },
    ) as never)

    expect(search).toHaveBeenCalledWith({ actorId: 'admin-1', cursor: null, filters: { q: 'ritz' }, limit: 5 })
    expect(entityPage).toHaveBeenCalledWith({
      actorId: 'admin-1', query: 'ritz', type: null, status: null, afterId: null, limit: 5,
    })
    await expect(response.json()).resolves.toEqual({
      curations: [{ curation_id: 'cur_1' }],
      entities: [{ id: 'rest_1' }],
      collections: [
        { id: 'col_1', slug: 'victoria', title: 'Victoria', lifecycle: 'published', draftSelectedCount: 3 },
        { id: 'col_2', slug: 'ritz', title: 'Ritz picks', lifecycle: 'draft', draftSelectedCount: 0 },
      ],
    })
  })

  test('matches the Collection title or slug without case and with the query escaped', async () => {
    const handler = recordEndpoints(
      () => ({ entityPage: vi.fn().mockResolvedValue({ items: [] }) }) as never,
      () => ({ search: vi.fn().mockResolvedValue({ items: [] }) }) as never,
    ).find((entry) => entry.method === 'get' && entry.path === '/admin/v1/records/search')!.handler

    const payload = payloadFor()
    await handler(requestFor(
      'https://admin.example.test/api/admin/v1/records/search?q=Ritz%2B',
      { payload },
    ) as never)

    // `Ritz+` is text, not a pattern: the `+` is escaped before it reaches Mongo.
    expect(payload.collectionFinds).toEqual([{ $or: [{ title: /Ritz\+/i }, { slug: /Ritz\+/i }] }])
  })

  test('a Collection missing its optional counters still answers with a number', async () => {
    const handler = recordEndpoints(
      () => ({ entityPage: vi.fn().mockResolvedValue({ items: [] }) }) as never,
      () => ({ search: vi.fn().mockResolvedValue({ items: [] }) }) as never,
    ).find((entry) => entry.method === 'get' && entry.path === '/admin/v1/records/search')!.handler

    const response = await handler(requestFor(
      'https://admin.example.test/api/admin/v1/records/search?q=ritz',
      { payload: payloadFor({ collections: [{ _id: 'col_3', title: 'Bare' }] }) },
    ) as never)

    await expect(response.json()).resolves.toEqual({
      curations: [],
      entities: [],
      collections: [{ id: 'col_3', slug: '', title: 'Bare', lifecycle: '', draftSelectedCount: 0 }],
    })
  })

  test('refuses an empty query instead of searching the whole collection', async () => {
    const search = vi.fn()
    const entityPage = vi.fn()
    const handler = recordEndpoints(
      () => ({ entityPage }) as never,
      () => ({ search }) as never,
    ).find((entry) => entry.method === 'get' && entry.path === '/admin/v1/records/search')!.handler

    const response = await handler(requestFor('https://admin.example.test/api/admin/v1/records/search') as never)

    expect(response.status).toBe(400)
    expect(search).not.toHaveBeenCalled()
    expect(entityPage).not.toHaveBeenCalled()
  })
})
