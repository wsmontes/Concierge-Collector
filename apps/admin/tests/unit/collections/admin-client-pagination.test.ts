import { describe, expect, test, vi } from 'vitest'
import { createBrowserCollectionsAdminClient } from '../../../src/collections/admin-client'

const row = (id: string, title: string) => ({
  id,
  slug: title.toLowerCase(),
  title,
  description: null,
  lifecycle: 'draft' as const,
  currentPublishedVersion: null,
  draftRevision: 0,
  draftState: 'clean' as const,
  publishedSelectedCount: 0,
  draftSelectedCount: 0,
  revision: 1,
})

describe('CollectionsAdminClient list pagination', () => {
  test('follows bounded server cursors without truncating Collections', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [row('507f1f77bcf86cd799439011', 'Alpha')],
        nextCursor: 'cursor-2',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [row('507f1f77bcf86cd799439012', 'Beta')],
        nextCursor: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const client = createBrowserCollectionsAdminClient({ fetcher: fetcher as typeof fetch })

    await expect(client.list()).resolves.toMatchObject([
      { id: '507f1f77bcf86cd799439011', title: 'Alpha' },
      { id: '507f1f77bcf86cd799439012', title: 'Beta' },
    ])
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/admin/v1/collections',
      '/api/admin/v1/collections?cursor=cursor-2',
    ])
  })

  test('rejects a repeated server cursor instead of looping forever', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [],
      nextCursor: 'same-cursor',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = createBrowserCollectionsAdminClient({ fetcher: fetcher as typeof fetch })

    await expect(client.list()).rejects.toMatchObject({
      name: 'CollectionsAdminError',
      code: 'invalid_pagination',
      status: 0,
      retryable: false,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
