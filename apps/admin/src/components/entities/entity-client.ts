/**
 * Browser client for the Entity record boundary.
 *
 * The list, the preview drawer and the full Entity editor all read Entities
 * through this module, so a failure has exactly one shape: the Admin BFF error
 * body (`src/http/errors.ts`) as `{ status, code }`, narrowable with
 * `isAdminRequestFailure` like any server-thrown failure.
 */

import type {
  AdminRequestFailure,
  CurationRecordResponse,
  EntitySearchPage,
  LoadEntityPage,
  LoadEntityRecord,
} from '../../content/record-types'

/** Curations about one Entity, as `GET …/records/entities/:id/curations` returns them. */
export interface EntityCurationPage {
  items: Record<string, unknown>[]
  total: number
}

/** Page size the Entities list asks for when the caller does not override it. */
export const ENTITY_PAGE_LIMIT = 50

type AdminErrorBody = { error?: { code?: unknown } }

export class EntityRequestError extends Error implements AdminRequestFailure {
  constructor(readonly status: number, readonly code: string) {
    super(code)
    this.name = 'EntityRequestError'
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')

  let response: Response
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin', headers })
  } catch {
    throw new EntityRequestError(0, 'network_error')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as AdminErrorBody | null
    const code = typeof body?.error?.code === 'string' ? body.error.code : `http_${response.status}`
    throw new EntityRequestError(response.status, code)
  }

  return response.json() as Promise<T>
}

/** The list request path; `limit` is always explicit so a page stays reproducible. */
export function entityPagePath(input: {
  cursor: string | null
  query: string
  type: string | null
  status: string | null
  limit?: number
}): string {
  const params = new URLSearchParams()
  if (input.query) params.set('q', input.query)
  if (input.type) params.set('type', input.type)
  if (input.status) params.set('status', input.status)
  if (input.cursor) params.set('cursor', input.cursor)
  params.set('limit', String(input.limit ?? ENTITY_PAGE_LIMIT))
  return `/api/admin/v1/records/entities?${params.toString()}`
}

/** Default `loadPage` of the Entities list. */
export const browserLoadEntityPage: LoadEntityPage = (input) => requestJson<EntitySearchPage>(entityPagePath(input))

/** Default `loadRecord` of the Entity preview and the full Entity editor. */
export const browserLoadEntityRecord: LoadEntityRecord = (entityId) =>
  requestJson<{ record: Record<string, unknown> }>(`/api/admin/v1/records/entities/${encodeURIComponent(entityId)}`)

/** Curations about one Entity (plan §22). */
export const browserLoadEntityCurations = (entityId: string, cursor: string | null = null): Promise<EntityCurationPage> => {
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return requestJson<EntityCurationPage>(`/api/admin/v1/records/entities/${encodeURIComponent(entityId)}/curations${suffix}`)
}

/** One Curation, for the Curation preview reachable from an Entity (plan §23). */
export const browserLoadCurationRecord = (curationId: string): Promise<CurationRecordResponse> =>
  requestJson<CurationRecordResponse>(`/api/admin/v1/records/curations/${encodeURIComponent(curationId)}`)
