/**
 * Default browser loader of the global search palette.
 *
 * The palette is a BFF client like every other editorial surface: one request
 * to `/api/admin/v1/records/search`, one normalized `SearchResults`. A failure
 * keeps the Admin BFF error shape (`src/http/errors.ts`) so the palette can
 * render an error state without knowing the transport.
 */

import type { AdminRequestFailure, EntityRow } from '../../content/record-types'
import { isRecord } from '../../content/value-guards'
import type { AdminCurationRow } from '../../explorer/types'
import type { CollectionHit, SearchResults } from './search-types'

/** Rows the palette asks for per record family; the BFF caps this at 25. */
export const SEARCH_RESULT_LIMIT = 8

type AdminErrorBody = { error?: { code?: unknown } }

export class GlobalSearchRequestError extends Error implements AdminRequestFailure {
  constructor(readonly status: number, readonly code: string) {
    super(code)
    this.name = 'GlobalSearchRequestError'
  }
}

/** The one request path of the palette; `limit` is always explicit. */
export function searchPath(query: string, limit: number = SEARCH_RESULT_LIMIT): string {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  return `/api/admin/v1/records/search?${params.toString()}`
}

async function requestJson<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new GlobalSearchRequestError(0, 'network_error')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as AdminErrorBody | null
    const code = typeof body?.error?.code === 'string' ? body.error.code : `http_${response.status}`
    throw new GlobalSearchRequestError(response.status, code)
  }

  return response.json() as Promise<T>
}

/**
 * A family the BFF did not send is an empty family, never an invented row: the
 * palette's grouping then omits that heading entirely.
 */
function rowsOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

/** Default `loadResults` of the palette. */
export async function browserLoadResults(query: string): Promise<SearchResults> {
  const body: unknown = await requestJson<unknown>(searchPath(query))
  const record = isRecord(body) ? body : {}
  return {
    entities: rowsOf<EntityRow>(record.entities),
    curations: rowsOf<AdminCurationRow>(record.curations),
    collections: rowsOf<CollectionHit>(record.collections),
  }
}
