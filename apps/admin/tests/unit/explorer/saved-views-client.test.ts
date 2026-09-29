import { describe, expect, test, vi } from 'vitest'
import { createSavedCurationViewsClient } from '../../../src/explorer/saved-views-client'

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

describe('Saved Curation Views client', () => {
  test('lists, creates and deletes only through the private admin BFF', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ items: [{ id: 'view-1', name: 'Victoria', normalizedFilters: { city: 'Victoria' } }] }))
      .mockResolvedValueOnce(response({ id: 'view-2', name: 'Drafts', normalizedFilters: { status: ['draft'] } }, 201))
      .mockResolvedValueOnce(response({ id: 'view-2' }))
    const client = createSavedCurationViewsClient(fetcher as never)

    await expect(client.list()).resolves.toHaveLength(1)
    await client.create('Drafts', { status: ['draft'] })
    await client.remove('view-2')

    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/v1/curation-views')
    expect(fetcher.mock.calls[1][0]).toBe('/api/admin/v1/curation-views')
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(JSON.parse(String(fetcher.mock.calls[1][1].body))).toEqual({
      name: 'Drafts', normalizedFilters: { status: ['draft'] }, sort: null, visibleColumns: null,
    })
    expect(fetcher.mock.calls[2][0]).toBe('/api/admin/v1/curation-views/view-2')
    expect(fetcher.mock.calls[2][1]).toMatchObject({ method: 'DELETE' })
  })

  test('uses the standard nested admin error shape', async () => {
    const client = createSavedCurationViewsClient(vi.fn().mockResolvedValue(response({ error: { code: 'forbidden' } }, 403)) as never)
    await expect(client.list()).rejects.toThrow('forbidden')
  })
})
