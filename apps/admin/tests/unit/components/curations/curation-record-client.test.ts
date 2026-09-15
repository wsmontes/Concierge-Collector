import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CurationRecordError,
  loadCurationRecordFromBff,
  saveCurationRecordToBff,
} from '../../../../src/components/curations/curation-record-client'
import { isAdminRequestFailure } from '../../../../src/content/record-types'

/**
 * The page branches on the failure *shape*, so the default client has to hand
 * back exactly what `isAdminRequestFailure` narrows on: a numeric `status` and
 * a string `code`. These tests exercise the real fetch call, not a mock of it.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubFetch(response: Response) {
  const fetcher = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

function stubRejectingFetch() {
  const fetcher = vi.fn(() => Promise.reject(new Error('unreachable')))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadCurationRecordFromBff', () => {
  test('reads the record and its Collection links from the record route', async () => {
    const fetcher = stubFetch(jsonResponse({
      record: { curation_id: 'cur_1', version: 4 },
      collections: [
        { collection_id: 'col_1', slug: 'business', title: 'Business Lunches', current_published_version: 2 },
        { collection_id: '', title: 'broken' },
      ],
    }))

    const loaded = await loadCurationRecordFromBff('cur_1')

    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/v1/records/curations/cur_1')
    expect(loaded.record).toEqual({ curation_id: 'cur_1', version: 4 })
    expect(loaded.collections).toEqual([
      { collection_id: 'col_1', slug: 'business', title: 'Business Lunches', current_published_version: 2 },
    ])
  })

  test('a 404 arrives as an AdminRequestFailure carrying the BFF code', async () => {
    stubFetch(jsonResponse({ error: { code: 'not_found' } }, 404))

    const failure = await loadCurationRecordFromBff('cur_1').catch((error: unknown) => error)

    expect(isAdminRequestFailure(failure)).toBe(true)
    expect(failure).toBeInstanceOf(CurationRecordError)
    expect((failure as CurationRecordError).status).toBe(404)
    expect((failure as CurationRecordError).code).toBe('not_found')
  })

  test('an unrouted failure still yields a numeric status and a code', async () => {
    stubFetch(new Response('not json', { status: 500 }))

    const failure = await loadCurationRecordFromBff('cur_1').catch((error: unknown) => error)

    expect(isAdminRequestFailure(failure)).toBe(true)
    expect((failure as CurationRecordError).code).toBe('http_500')
  })

  test('a transport failure is reported as a failure, never as an empty record', async () => {
    stubRejectingFetch()

    const failure = await loadCurationRecordFromBff('cur_1').catch((error: unknown) => error)

    expect((failure as CurationRecordError).code).toBe('network_error')
    expect((failure as CurationRecordError).status).toBe(0)
  })
})

describe('saveCurationRecordToBff', () => {
  test('PATCHes only the touched top-level keys plus the opened version', async () => {
    const fetcher = stubFetch(jsonResponse({ record: { curation_id: 'cur_1', version: 5 } }))

    await saveCurationRecordToBff({
      curationId: 'cur_1',
      updates: { notes: { public: 'New public note' } },
      expectedVersion: 4,
    })

    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/v1/records/curations/cur_1')
    const init = fetcher.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('PATCH')
    expect(init.credentials).toBe('same-origin')
    expect(init.body).toBe(JSON.stringify({
      updates: { notes: { public: 'New public note' } },
      expectedVersion: 4,
    }))
  })

  test('a 409 arrives as an AdminRequestFailure so the page can show a conflict', async () => {
    stubFetch(jsonResponse({ error: { code: 'conflict' } }, 409))

    const failure = await saveCurationRecordToBff({
      curationId: 'cur_1',
      updates: { status: 'active' },
      expectedVersion: 4,
    }).catch((error: unknown) => error)

    expect(isAdminRequestFailure(failure)).toBe(true)
    expect((failure as CurationRecordError).status).toBe(409)
    expect((failure as CurationRecordError).code).toBe('conflict')
  })
})
