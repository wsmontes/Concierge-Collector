import { describe, expect, test, vi } from 'vitest'
import { AdminHttpError } from '../../../src/http/errors'
// Static on purpose: `vi.mock` below is hoisted by the runner, so this module
// graph already receives the mocked `with-admin`.
import { collectionReadEndpoints } from '../../../src/payload/endpoints/collection-reads'
import { makeRows } from '../../support/factories'

const actor = {
  authz_revision: 'revision-1', authorized: true, email: 'admin@example.test', name: 'Admin', picture: null,
  role: 'admin' as const, user_id: 'admin-1',
}

/**
 * Mirrors the real wrapper: it proves a session and turns whatever the handler
 * throws into the Admin error response, exactly like `with-admin` does.
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

const COLLECTION_ID = '507f1f77bcf86cd799439011'
const MEMBERS_URL = `https://admin.example.test/api/admin/v1/collections/${COLLECTION_ID}/members?limit=2`
const DIFF_URL = `https://admin.example.test/api/admin/v1/collections/${COLLECTION_ID}/draft/diff?limit=2`

interface ModelRows {
  collections?: Record<string, unknown>[]
  memberships?: Record<string, unknown>[]
  draftChanges?: Record<string, unknown>[]
}

/** Minimal stand-in for the CMS models these read handlers query. */
function payloadFor({ collections = [], memberships = [], draftChanges = [] }: ModelRows) {
  const model = (rows: Record<string, unknown>[]) => ({
    findById: () => ({ lean: async () => rows[0] ?? null }),
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => rows }) }) }),
  })
  return {
    db: {
      collections: {
        collections: model(collections),
        'collection-memberships': model(memberships),
        'collection-draft-changes': model(draftChanges),
      },
    },
  }
}

function requestFor(url: string, payload: unknown) {
  const request = new Request(url)
  return Object.assign(request, { routeParams: { id: COLLECTION_ID }, payload })
}

function handlerFor(path: string, curationSummaries: (ids: string[], actorId: string) => Promise<unknown>) {
  const endpoint = collectionReadEndpoints(() => ({ curationSummaries }) as never).find(
    (entry) => entry.method === 'get' && entry.path === path,
  )
  if (!endpoint) throw new Error(`Missing endpoint ${path}`)
  return endpoint.handler
}

function row(curationId: string, restaurantName: string) {
  return makeRows(1, { curation_id: curationId, restaurant_name: restaurantName })[0]
}

describe('Collection members read model', () => {
  test('humanizes a whole page with exactly one summaries call', async () => {
    const curationSummaries = vi.fn().mockResolvedValue({ items: [row('cur_1', 'Ritz Restaurant')] })
    const handler = handlerFor('/admin/v1/collections/:id/members', curationSummaries)

    const response = await handler(requestFor(MEMBERS_URL, payloadFor({
      collections: [{ currentPublishedVersion: 3 }],
      memberships: [{ curationId: 'cur_1' }, { curationId: 'cur_2' }],
    })) as never)

    expect(response.status).toBe(200)
    expect(curationSummaries).toHaveBeenCalledTimes(1)
    expect(curationSummaries).toHaveBeenCalledWith(['cur_1', 'cur_2'], 'admin-1')
    await expect(response.json()).resolves.toEqual({
      items: [
        { curationId: 'cur_1', summary: row('cur_1', 'Ritz Restaurant') },
        // An id the catalog no longer holds stays `null`: the row is never
        // filled with a fabricated label.
        { curationId: 'cur_2', summary: null },
      ],
      nextCursor: null,
    })
  })

  test('asks the boundary once per page even when one id repeats', async () => {
    const curationSummaries = vi.fn().mockResolvedValue({ items: [] })
    const handler = handlerFor('/admin/v1/collections/:id/members', curationSummaries)

    const response = await handler(requestFor(MEMBERS_URL, payloadFor({
      collections: [{ currentPublishedVersion: 1 }],
      memberships: [{ curationId: 'cur_1' }, { curationId: 'cur_1' }],
    })) as never)

    expect(response.status).toBe(200)
    expect(curationSummaries).toHaveBeenCalledTimes(1)
    expect(curationSummaries).toHaveBeenCalledWith(['cur_1'], 'admin-1')
  })

  test('never reaches the boundary for a page with no members', async () => {
    const curationSummaries = vi.fn()
    const handler = handlerFor('/admin/v1/collections/:id/members', curationSummaries)

    const response = await handler(requestFor(MEMBERS_URL, payloadFor({
      collections: [{ currentPublishedVersion: 3 }],
    })) as never)

    expect(response.status).toBe(200)
    expect(curationSummaries).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({ items: [], nextCursor: null })
  })

  test('fails the page instead of silently dropping every summary', async () => {
    const curationSummaries = vi.fn().mockRejectedValue(new AdminHttpError(503, 'service_unavailable'))
    const handler = handlerFor('/admin/v1/collections/:id/members', curationSummaries)

    const response = await handler(requestFor(MEMBERS_URL, payloadFor({
      collections: [{ currentPublishedVersion: 3 }],
      memberships: [{ curationId: 'cur_1' }],
    })) as never)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: { code: 'service_unavailable' } })
  })
})

describe('Collection draft diff read model', () => {
  test('humanizes each pending change and keeps the operation linkage', async () => {
    const curationSummaries = vi.fn().mockResolvedValue({ items: [row('cur_2', 'D.O.M.')] })
    const handler = handlerFor('/admin/v1/collections/:id/draft/diff', curationSummaries)

    const response = await handler(requestFor(DIFF_URL, payloadFor({
      collections: [{ currentPublishedVersion: 1, draftEpoch: 'epoch-1', draftRevision: 4 }],
      draftChanges: [
        { curationId: 'cur_1', desiredState: 'add', operationId: 'op_1' },
        { curationId: 'cur_2', desiredState: 'remove', operationId: 'op_2' },
      ],
    })) as never)

    expect(response.status).toBe(200)
    expect(curationSummaries).toHaveBeenCalledTimes(1)
    expect(curationSummaries).toHaveBeenCalledWith(['cur_1', 'cur_2'], 'admin-1')
    await expect(response.json()).resolves.toEqual({
      items: [
        { curationId: 'cur_1', desiredState: 'add', operationId: 'op_1', summary: null },
        { curationId: 'cur_2', desiredState: 'remove', operationId: 'op_2', summary: row('cur_2', 'D.O.M.') },
      ],
      nextCursor: null,
    })
  })

  test('never reaches the boundary for a draft with no changes', async () => {
    const curationSummaries = vi.fn()
    const handler = handlerFor('/admin/v1/collections/:id/draft/diff', curationSummaries)

    const response = await handler(requestFor(DIFF_URL, payloadFor({
      collections: [{ currentPublishedVersion: 1, draftEpoch: 'epoch-1', draftRevision: 4 }],
    })) as never)

    expect(response.status).toBe(200)
    expect(curationSummaries).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({ items: [], nextCursor: null })
  })
})
