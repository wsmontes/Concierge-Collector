import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CollectionsAdminError,
  createBrowserCollectionsAdminClient,
  type AdminCollectionRecord,
} from '../../../src/collections/admin-client'

const collection: AdminCollectionRecord = {
  id: '507f1f77bcf86cd799439011',
  slug: 'victoria',
  title: 'Victoria',
  description: null,
  lifecycle: 'published',
  currentPublishedVersion: 2,
  draftRevision: 7,
  draftState: 'dirty',
  publishedSelectedCount: 8,
  draftSelectedCount: 9,
  revision: 12,
}

afterEach(() => vi.restoreAllMocks())

describe('CollectionsAdminClient', () => {
  test('patch metadata sends the current revision and command headers', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...collection,
      title: 'Victoria 2027',
      revision: 13,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const ids = ['idem-1', 'request-1']
    const client = createBrowserCollectionsAdminClient({
      fetcher: fetcher as typeof fetch,
      uuid: () => ids.shift() ?? 'fallback',
    })

    await client.patchMetadata(collection, { title: 'Victoria 2027' })

    expect(fetcher).toHaveBeenCalledTimes(1)
    const [path, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/admin/v1/collections/507f1f77bcf86cd799439011')
    expect(init).toMatchObject({ method: 'PATCH', credentials: 'same-origin' })
    expect(init.headers).toMatchObject({
      'If-Match': '12',
      'Idempotency-Key': 'idem-1',
      'X-Request-Id': 'request-1',
    })
    expect(JSON.parse(String(init.body))).toEqual({ title: 'Victoria 2027' })
  })

  test('publish preserves an explicit logical idempotency key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'job-1',
      status: 'queued',
    }), { status: 202, headers: { 'content-type': 'application/json' } }))
    const client = createBrowserCollectionsAdminClient({
      fetcher: fetcher as typeof fetch,
      uuid: () => 'request-1',
    })

    await client.publish(
      collection,
      { confirmUnavailable: true, expectedUnavailableCount: 2 },
      'publish-command-1',
    )

    const [path, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/admin/v1/collections/507f1f77bcf86cd799439011/publish')
    expect(init.headers).toMatchObject({
      'If-Match': '12',
      'Idempotency-Key': 'publish-command-1',
      'X-Request-Id': 'request-1',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      confirmUnavailable: true,
      expectedUnavailableCount: 2,
    })
  })

  test('reads the nested administrative error shape and preserves safe details', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'unavailable_confirmation_required',
        unavailableCount: '3',
      },
    }), { status: 409, headers: { 'content-type': 'application/json' } }))
    const client = createBrowserCollectionsAdminClient({
      fetcher: fetcher as typeof fetch,
      uuid: () => 'request-1',
    })

    await expect(client.get(collection.id)).rejects.toEqual(new CollectionsAdminError(
      'unavailable_confirmation_required',
      409,
      false,
      { unavailableCount: '3' },
    ))
  })

  test('network failures remain retryable', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('offline'))
    const client = createBrowserCollectionsAdminClient({
      fetcher: fetcher as typeof fetch,
      uuid: () => 'request-1',
    })

    await expect(client.get(collection.id)).rejects.toEqual(new CollectionsAdminError(
      'network_error',
      0,
      true,
    ))
  })
})
