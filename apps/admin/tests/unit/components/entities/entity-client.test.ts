import { afterEach, expect, test, vi } from 'vitest'
import {
  browserLoadEntityPage,
  browserLoadEntityRecord,
  EntityRequestError,
  entityPagePath,
} from '../../../../src/components/entities/entity-client'
import { isAdminRequestFailure } from '../../../../src/content/record-types'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('builds the list request from the applied filter state', () => {
  expect(entityPagePath({ cursor: 'c1', query: 'ritz', type: 'restaurant', status: 'active' }))
    .toBe('/api/admin/v1/records/entities?q=ritz&type=restaurant&status=active&cursor=c1&limit=50')
  expect(entityPagePath({ cursor: null, query: '', type: null, status: null, limit: 25 }))
    .toBe('/api/admin/v1/records/entities?limit=25')
})

test('encodes the entity id in the record path', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ record: { name: 'Ritz' } }))
  vi.stubGlobal('fetch', fetcher)

  await expect(browserLoadEntityRecord('a b/c')).resolves.toEqual({ record: { name: 'Ritz' } })
  expect(fetcher.mock.calls[0][0]).toBe('/api/admin/v1/records/entities/a%20b%2Fc')
})

test('maps every failure to the AdminRequestFailure shape', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'not_found' } }, { status: 404 })))
  const notFound = await browserLoadEntityPage({ cursor: null, query: '', type: null, status: null })
    .catch((error: unknown) => error)
  expect(isAdminRequestFailure(notFound)).toBe(true)
  expect(notFound).toMatchObject({ status: 404, code: 'not_found' })

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gateway down', { status: 503 })))
  const unavailable = await browserLoadEntityPage({ cursor: null, query: '', type: null, status: null })
    .catch((error: unknown) => error)
  expect(unavailable).toMatchObject({ status: 503, code: 'http_503' })

  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  const offline = await browserLoadEntityRecord('x').catch((error: unknown) => error)
  expect(offline).toBeInstanceOf(EntityRequestError)
  expect(isAdminRequestFailure(offline)).toBe(true)
  expect(offline).toMatchObject({ status: 0, code: 'network_error' })
})
