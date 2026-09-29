import type { NormalizedCurationFilters } from './types'

export interface SavedCurationView {
  id: string
  name: string
  normalizedFilters: NormalizedCurationFilters | null
  sort: Record<string, unknown> | null
  visibleColumns: string[] | null
  createdAt?: string | null
  updatedAt?: string | null
}

export interface SavedCurationViewsClient {
  list(): Promise<SavedCurationView[]>
  create(name: string, filters: NormalizedCurationFilters): Promise<SavedCurationView>
  remove(id: string): Promise<void>
}

async function json<T>(fetcher: typeof fetch, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetcher(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null
    throw new Error(typeof body?.error?.code === 'string' ? body.error.code : `http_${response.status}`)
  }
  return response.json() as Promise<T>
}

export function createSavedCurationViewsClient(fetcher: typeof fetch = fetch): SavedCurationViewsClient {
  return {
    async list() {
      const result = await json<{ items: SavedCurationView[] }>(fetcher, '/api/admin/v1/curation-views')
      return result.items
    },
    create(name, normalizedFilters) {
      return json<SavedCurationView>(fetcher, '/api/admin/v1/curation-views', {
        method: 'POST',
        body: JSON.stringify({ name, normalizedFilters, sort: null, visibleColumns: null }),
      })
    },
    async remove(id) {
      await json<{ id: string }>(fetcher, `/api/admin/v1/curation-views/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
  }
}
