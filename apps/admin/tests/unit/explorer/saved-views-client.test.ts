import { describe, expect, test, vi } from 'vitest'
import { createSavedCurationViewsClient, savedViewColumns, savedViewSort } from '../../../src/explorer/saved-views-client'

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

  test('saves the sort and the visible columns alongside the filters (plan §27)', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ id: 'view-3', name: 'Recent', normalizedFilters: {} }))
    const client = createSavedCurationViewsClient(fetcher as never)

    await client.create('Recent', { city: 'Victoria' }, { sort: 'name_asc', visibleColumns: ['curation', 'created'] })

    expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({
      name: 'Recent',
      normalizedFilters: { city: 'Victoria' },
      sort: { id: 'name_asc' },
      visibleColumns: ['curation', 'created'],
    })
  })

  test('reads back the presentation state and ignores an unknown sort', () => {
    expect(savedViewSort({ id: 'v', name: 'v', normalizedFilters: null, sort: { id: 'name_asc' }, visibleColumns: null })).toBe('name_asc')
    expect(savedViewSort({ id: 'v', name: 'v', normalizedFilters: null, sort: { id: '-updatedAt' }, visibleColumns: null })).toBeNull()
    expect(savedViewSort({ id: 'v', name: 'v', normalizedFilters: null, sort: null, visibleColumns: null })).toBeNull()
    expect(savedViewColumns({ id: 'v', name: 'v', normalizedFilters: null, sort: null, visibleColumns: ['created'] }))
      .toEqual(['curation', 'created'])
    expect(savedViewColumns({ id: 'v', name: 'v', normalizedFilters: null, sort: null, visibleColumns: null })).toBeNull()
  })

  test('uses the standard nested admin error shape', async () => {
    const client = createSavedCurationViewsClient(vi.fn().mockResolvedValue(response({ error: { code: 'forbidden' } }, 403)) as never)
    await expect(client.list()).rejects.toThrow('forbidden')
  })
})
