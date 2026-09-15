import { afterEach, describe, expect, test, vi } from 'vitest'
import { createBrowserEntityDetailClient, EntityDetailError } from '../../../../src/components/entities/entity-detail-client'
import { isAdminRequestFailure } from '../../../../src/content/record-types'

/**
 * The Entity detail client is the only place the BFF paths exist. Every test
 * below pins one route, one verb and one body — a path typo must fail here.
 */

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EntityDetail client', () => {
  test('loads a stored record through the Entity records route', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ record: { entity_id: 'entity-ritz', version: 3 } }))
    vi.stubGlobal('fetch', fetcher)

    const result = await createBrowserEntityDetailClient().loadRecord('entity-ritz')

    expect(result.record).toEqual({ entity_id: 'entity-ritz', version: 3 })
    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/v1/records/entities/entity-ritz')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' })
  })

  test('saves one root key with the expected version over PATCH', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ record: { name: 'Le Grand Ritz', version: 4 } }))
    vi.stubGlobal('fetch', fetcher)

    const result = await createBrowserEntityDetailClient().saveRecord({
      entityId: 'entity-ritz',
      updates: { name: 'Le Grand Ritz' },
      expectedVersion: 3,
    })

    expect(result.record).toEqual({ name: 'Le Grand Ritz', version: 4 })
    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/v1/records/entities/entity-ritz')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({
      updates: { name: 'Le Grand Ritz' },
      expectedVersion: 3,
    })
  })

  test('loads the Curations about an Entity and keeps only shaped documents', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({ items: [{ curation_id: 'cur_1' }, 'not-a-record'], total: 9 }),
    )
    vi.stubGlobal('fetch', fetcher)

    const page = await createBrowserEntityDetailClient().loadCurations('entity-ritz')

    expect(page.items).toEqual([{ curation_id: 'cur_1' }])
    expect(page.total).toBe(9)
    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/v1/records/entities/entity-ritz/curations')
  })

  test('surfaces a BFF failure as an error the caller can branch on', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: { code: 'version_conflict' } }, 409))
    vi.stubGlobal('fetch', fetcher)

    const failure = await createBrowserEntityDetailClient()
      .saveRecord({ entityId: 'entity-ritz', updates: { name: 'X' }, expectedVersion: 1 })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(EntityDetailError)
    expect(isAdminRequestFailure(failure)).toBe(true)
    if (!isAdminRequestFailure(failure)) return
    expect(failure.status).toBe(409)
    expect(failure.code).toBe('version_conflict')
  })

  test('reports a transport failure and an unshaped payload instead of guessing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const network = await createBrowserEntityDetailClient()
      .loadRecord('entity-ritz')
      .catch((error: unknown) => error)
    expect(isAdminRequestFailure(network)).toBe(true)
    if (!isAdminRequestFailure(network)) return
    expect(network.status).toBe(0)
    expect(network.code).toBe('network_error')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ notARecord: true })))
    const invalid = await createBrowserEntityDetailClient()
      .loadRecord('entity-ritz')
      .catch((error: unknown) => error)
    expect(isAdminRequestFailure(invalid)).toBe(true)
    if (!isAdminRequestFailure(invalid)) return
    expect(invalid.code).toBe('invalid_response')
  })
})
