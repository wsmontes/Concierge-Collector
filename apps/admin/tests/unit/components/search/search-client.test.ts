import { afterEach, expect, test, vi } from 'vitest'
import {
  browserLoadResults,
  GlobalSearchRequestError,
  searchPath,
  SEARCH_RESULT_LIMIT,
} from '../../../../src/components/search/search-client'
import { isAdminRequestFailure } from '../../../../src/content/record-types'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('builds the one palette request, always bounded', () => {
  expect(searchPath('ritz')).toBe(`/api/admin/v1/records/search?q=ritz&limit=${SEARCH_RESULT_LIMIT}`)
  expect(searchPath('ritz grey')).toBe(`/api/admin/v1/records/search?q=ritz+grey&limit=${SEARCH_RESULT_LIMIT}`)
})

test('reads the three families from the BFF with the session cookie', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({
    entities: [{ id: 'rest_1' }],
    curations: [{ curation_id: 'cur_1' }],
    collections: [{ id: 'col_1' }],
  }))
  vi.stubGlobal('fetch', fetcher)

  await expect(browserLoadResults('ritz')).resolves.toEqual({
    entities: [{ id: 'rest_1' }],
    curations: [{ curation_id: 'cur_1' }],
    collections: [{ id: 'col_1' }],
  })
  expect(fetcher.mock.calls[0][0]).toBe(searchPath('ritz'))
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' })
})

test('a family the BFF did not send is an empty family, not a broken one', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ collections: [{ id: 'col_1' }] })))

  await expect(browserLoadResults('ritz')).resolves.toEqual({
    entities: [],
    curations: [],
    collections: [{ id: 'col_1' }],
  })
})

test('maps every failure onto the AdminRequestFailure shape', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'forbidden' } }, { status: 403 })))
  const forbidden = await browserLoadResults('ritz').catch((error: unknown) => error)
  expect(isAdminRequestFailure(forbidden)).toBe(true)
  expect(forbidden).toMatchObject({ status: 403, code: 'forbidden' })

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gateway down', { status: 503 })))
  const unavailable = await browserLoadResults('ritz').catch((error: unknown) => error)
  expect(unavailable).toMatchObject({ status: 503, code: 'http_503' })

  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  const offline = await browserLoadResults('ritz').catch((error: unknown) => error)
  expect(offline).toBeInstanceOf(GlobalSearchRequestError)
  expect(offline).toMatchObject({ status: 0, code: 'network_error' })
})
