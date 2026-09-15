import { afterEach, describe, expect, test, vi } from 'vitest'
import { CurationAdapter } from '../../../src/fastapi/curation-adapter'

// The real `@concierge/fastapi-client` stays in the graph: this test asserts the
// URL that actually leaves the Admin BFF. Only the CMS environment is doubled,
// because provisioned credentials are not part of the wire contract.
vi.mock('../../../src/env', () => ({
  readEnv: () => ({ fastApiBaseUrl: 'http://api.example.test', cmsServiceKey: 'service-key' }),
}))

/** Records every request URL the real client emits. */
function captureFetch(responder: () => Response): string[] {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return responder()
  }))
  return calls
}

const EMPTY_PAGE = { items: [], next_cursor: null, total: 0 }

afterEach(() => vi.unstubAllGlobals())

describe('CurationAdapter wire format', () => {
  test('sends advanced conditions as repeated where parameters', async () => {
    const calls = captureFetch(() => Response.json(EMPTY_PAGE))

    await new CurationAdapter().search({
      actorId: 'admin-1',
      cursor: 'cursor-1',
      filters: {
        unlinked: true,
        concepts: [{ category: 'Mood', value: 'Casual' }],
        where: [
          { field: 'curator_type', op: 'equals', value: 'synthetic' },
          { field: 'sources.audio', op: 'exists' },
        ],
      },
      limit: 50,
      sort: 'updated_at_desc',
    })

    const url = new URL(calls[0])
    expect(url.pathname).toBe('/api/v3/catalog/curations')
    expect(url.searchParams.getAll('where')).toEqual([
      '{"field":"curator_type","op":"equals","value":"synthetic"}',
      '{"field":"sources.audio","op":"exists"}',
    ])
    expect(url.searchParams.get('unlinked')).toBe('true')
    expect(url.searchParams.getAll('concept.Mood')).toEqual(['Casual'])
    expect(url.searchParams.get('sort')).toBe('updated_at_desc')
    expect(url.searchParams.get('cursor')).toBe('cursor-1')
    expect(url.searchParams.get('limit')).toBe('50')
  })

  test('carries no where or unlinked key when nothing was applied', async () => {
    const calls = captureFetch(() => Response.json(EMPTY_PAGE))

    await new CurationAdapter().search({ actorId: 'admin-1', cursor: null, filters: { city: 'Victoria' }, limit: 100 })

    const url = new URL(calls[0])
    expect(url.searchParams.get('where')).toBeNull()
    expect(url.searchParams.get('unlinked')).toBeNull()
    expect(url.searchParams.get('city')).toBe('Victoria')
  })

  test('reports a service refusal as a revoked authorization, never a 503', async () => {
    captureFetch(() => new Response('unauthorized', { status: 401 }))

    await expect(new CurationAdapter().search({ actorId: 'admin-1', cursor: null, filters: {}, limit: 100 }))
      .rejects.toMatchObject({ status: 403, code: 'authorization_revoked' })
  })

  test('starts a scan with the base filters, the order and the exclusion, never the view mode', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ scan_token: 'scan-token', max_catalog_sequence: 20 })
    }))

    const token = await new CurationAdapter().startScan({
      actorId: 'admin-1',
      excludeCurationIds: ['cur-2', 'cur-4'],
      filters: { status: ['active'], q: 'sushi', without_collections: true },
      sort: 'updated_at_desc',
    })

    expect(token).toBe('scan-token')
    expect(bodies[0]).toEqual({
      filters: {
        q: 'sushi',
        status: ['active'],
        sort: 'updated_at_desc',
        exclude_curation_ids: ['cur-2', 'cur-4'],
      },
    })
  })

  test('walks one scan page into the ids the listing needs', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({
        items: [{ curation_id: 'cur-1' }, { curation_id: 'cur-2' }],
        next_cursor: 'cursor-2',
      })
    }))

    const page = await new CurationAdapter().scanPage({
      actorId: 'admin-1',
      cursor: null,
      limit: 500,
      scanToken: 'scan-token',
    })

    expect(page).toEqual({ ids: ['cur-1', 'cur-2'], nextCursor: 'cursor-2' })
    expect(bodies[0]).toEqual({ scan_token: 'scan-token', cursor: null, limit: 500 })
  })
})
