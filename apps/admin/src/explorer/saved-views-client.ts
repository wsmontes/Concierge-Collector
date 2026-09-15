import { normalizeCurationColumns, type CurationColumnId } from '../content/curation-columns'
import type { CurationSort } from '../content/record-types'
import { isRecord } from '../content/value-guards'
import { isCurationSort, type NormalizedCurationFilters } from './types'

export interface SavedCurationView {
  id: string
  name: string
  normalizedFilters: NormalizedCurationFilters | null
  sort: Record<string, unknown> | null
  visibleColumns: string[] | null
  createdAt?: string | null
  updatedAt?: string | null
}

/** Presentation state a view restores on top of its filters (plan §27). */
export interface SavedCurationViewOptions {
  sort?: CurationSort | null
  visibleColumns?: readonly CurationColumnId[] | null
}

export interface SavedCurationViewsClient {
  list(): Promise<SavedCurationView[]>
  create(name: string, filters: NormalizedCurationFilters, options?: SavedCurationViewOptions): Promise<SavedCurationView>
  remove(id: string): Promise<void>
}

/**
 * The view row stores `sort` as JSON. The BFF validates it as an object, so the
 * only key this client writes is `id`; a plain string is still read back, which
 * keeps older rows working.
 */
const SORT_KEY = 'id'

export function savedViewSort(view: SavedCurationView): CurationSort | null {
  const stored = view.sort
  if (typeof stored === 'string') return isCurationSort(stored) ? stored : null
  const id = isRecord(stored) ? stored[SORT_KEY] : undefined
  return typeof id === 'string' && isCurationSort(id) ? id : null
}

export function savedViewColumns(view: SavedCurationView): CurationColumnId[] | null {
  return view.visibleColumns ? normalizeCurationColumns(view.visibleColumns) : null
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
    create(name, normalizedFilters, options) {
      const sort = options?.sort ?? null
      const visibleColumns = options?.visibleColumns ?? null
      return json<SavedCurationView>(fetcher, '/api/admin/v1/curation-views', {
        method: 'POST',
        body: JSON.stringify({
          name,
          normalizedFilters,
          sort: sort ? { [SORT_KEY]: sort } : null,
          visibleColumns: visibleColumns?.length ? [...visibleColumns] : null,
        }),
      })
    },
    async remove(id) {
      await json<{ id: string }>(fetcher, `/api/admin/v1/curation-views/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
  }
}
