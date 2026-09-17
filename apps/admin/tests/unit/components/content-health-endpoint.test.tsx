import { describe, expect, test, vi } from 'vitest'
// Static on purpose: `vi.mock` below is hoisted by the runner, so this module
// graph already receives the mocked `with-admin`.
import { healthEndpoints } from '../../../src/payload/endpoints/health'

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

const HEALTH_URL = 'https://admin.example.test/api/admin/v1/records/content-health'

/** The membership ledger as this endpoint reads it: `distinct` over live rows. */
function payloadFor(curationIds: string[]) {
  const distinct = vi.fn().mockResolvedValue(curationIds)
  return {
    distinct,
    payload: { db: { collections: { 'collection-memberships': { distinct } } } },
  }
}

function requestFor(payload: unknown) {
  return Object.assign(new Request(HEALTH_URL), { routeParams: {}, payload }) as never
}

function handlerFor(contentHealth: (memberIds: readonly string[], actorId: string) => Promise<unknown>) {
  const endpoint = healthEndpoints(() => ({ contentHealth }) as never)
    .find((entry) => entry.path === '/admin/v1/records/content-health')
  if (!endpoint) throw new Error('Missing content-health endpoint')
  return endpoint.handler
}

const counters = {
  total: 18430,
  unlinked: 1203,
  synthetic_drafts: 312,
  without_images: 630,
  without_transcript: 4021,
  updated_today: 125,
  without_collections: 2491,
}

describe('Content health endpoint', () => {
  test('answers the boundary counters plus the size of the live membership ledger', async () => {
    const ledger = payloadFor(['cur_2', 'cur_1'])
    const contentHealth = vi.fn().mockResolvedValue(counters)

    const response = await handlerFor(contentHealth)(requestFor(ledger.payload))

    expect(response.status).toBe(200)
    expect(ledger.distinct).toHaveBeenCalledWith('curationId', { removedInVersion: null })
    // A removed membership is not a membership, and the ids travel sorted so a
    // bounded forward stays deterministic.
    expect(contentHealth).toHaveBeenCalledWith(['cur_1', 'cur_2'], 'admin-1')
    await expect(response.json()).resolves.toEqual({
      ...counters,
      collections_members_tracked: 2,
      degraded: null,
      // A cobertura de mídia de exibição atravessa o BFF; quando a fronteira não
      // a responde, o campo chega nulo (nunca zero, que afirmaria um fato).
      entities_total: null,
      entities_display_media_resolved: null,
      entities_no_sources: null,
      entities_unresolved: null,
    })
  })

  test('bounds the member set it forwards and marks the dependent counter unknown', async () => {
    const ledger = payloadFor(Array.from({ length: 10001 }, (_, index) => `cur_${String(index).padStart(5, '0')}`))
    const contentHealth = vi.fn().mockResolvedValue(counters)

    const response = await handlerFor(contentHealth)(requestFor(ledger.payload))

    const forwarded = contentHealth.mock.calls[0][0]
    expect(forwarded).toHaveLength(10000)
    expect(forwarded[0]).toBe('cur_00000')
    expect(forwarded.at(-1)).toBe('cur_09999')
    const body = await response.json()
    // The boundary answered against a partial set, so that one counter would be
    // a lie: it is reported as unknown, with the reason attached.
    expect(body.without_collections).toBeNull()
    expect(body.degraded).toContain('10000')
    expect(body.collections_members_tracked).toBe(10001)
    expect(body.total).toBe(18430)
  })
})
