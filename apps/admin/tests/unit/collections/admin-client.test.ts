import { afterEach, describe, expect, test, vi } from 'vitest'
import {
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
    const headers = new Headers(init.headers)
    expect(path).toBe('/api/admin/v1/collections/507f1f77bcf86cd799439011')
    expect(init).toMatchObject({ method: 'PATCH', credentials: 'same-origin' })
    expect(headers.get('If-Match')).toBe('12')
    expect(headers.get('Idempotency-Key')).toBe('idem-1')
    expect(headers.get('X-Request-Id')).toBe('request-1')
    expect(JSON.parse(String(init.body))).toEqual({ title: 'Victoria 2027' })
  })

  test('loads the exact live publish preview without mutating Collection state', async () => {
    const preview = {
      currentPublishedVersion: 2,
      nextVersion: 3,
      draftRevision: 7,
      revision: 12,
      selectedCount: 9,
      availableCount: 8,
      unavailableCount: 1,
      addCount: 2,
      removeCount: 1,
    }
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(preview), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const client = createBrowserCollectionsAdminClient({
      fetcher: fetcher as typeof fetch,
      uuid: () => 'request-1',
    })

    await expect(client.publishPreview(collection.id)).resolves.toEqual(preview)

    const [path, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/admin/v1/collections/507f1f77bcf86cd799439011/publish-preview')
    expect(init.credentials).toBe('same-origin')
    expect(init.method).toBeUndefined()
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
    const headers = new Headers(init.headers)
    expect(path).toBe('/api/admin/v1/collections/507f1f77bcf86cd799439011/publish')
    expect(headers.get('If-Match')).toBe('12')
    expect(headers.get('Idempotency-Key')).toBe('publish-command-1')
    expect(headers.get('X-Request-Id')).toBe('request-1')
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

    await expect(client.get(collection.id)).rejects.toMatchObject({
      name: 'CollectionsAdminError',
      code: 'unavailable_confirmation_required',
      status: 409,
      retryable: false,
      details: { unavailableCount: '3' },
    })
  })

  test('network failures remain retryable', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('offline'))
    const client = createBrowserCollectionsAdminClient({
      fetcher: fetcher as typeof fetch,
      uuid: () => 'request-1',
    })

    await expect(client.get(collection.id)).rejects.toMatchObject({
      name: 'CollectionsAdminError',
      code: 'network_error',
      status: 0,
      retryable: true,
    })
  })
})
