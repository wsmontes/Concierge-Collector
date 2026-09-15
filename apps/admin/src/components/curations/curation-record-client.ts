/**
 * The browser default for the Curation record endpoints.
 *
 * `CurationDetailWorkspace` takes its loader and saver by injection, so the
 * hard-coded BFF path and the HTTP⇒failure mapping live here and nowhere else.
 * A failure leaves as an `AdminRequestFailure`-shaped object: the numeric
 * `status` is what lets the page tell a stale-version 409 from a 404 without
 * guessing, and `isAdminRequestFailure` narrows on exactly this shape.
 */

import type {
  CurationCollectionLink,
  CurationRecordResponse,
  LoadCurationRecord,
  SaveCurationRecord,
} from '../../content/record-types'
import { isRecord } from '../../content/value-guards'
import { asString } from './curation-record-values'

/** The Admin BFF route this surface reads and writes. */
const RECORD_PATH = '/api/admin/v1/records/curations'

/** Codes the BFF emits for the statuses a caller branches on (src/http/errors.ts). */
const HOSTED_CODE: Record<number, string | undefined> = {
  400: 'invalid_request',
  401: 'authentication_required',
  403: 'authorization_denied',
  404: 'not_found',
  409: 'conflict',
  410: 'selection_expired',
  412: 'precondition_failed',
  423: 'locked',
  503: 'service_unavailable',
}

interface ErrorBody {
  error?: { code?: unknown }
}

/**
 * Carries the numeric `status` and string `code` the frozen
 * `AdminRequestFailure` contract is narrowed on.
 */
export class CurationRecordError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
    this.name = 'CurationRecordError'
  }
}

function recordPath(curationId: string): string {
  return `${RECORD_PATH}/${encodeURIComponent(curationId)}`
}

async function failureCode(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as ErrorBody | null
  const code = body?.error?.code
  if (typeof code === 'string' && code.length > 0) return code
  return HOSTED_CODE[response.status] ?? `http_${response.status}`
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  let response: Response
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin', headers })
  } catch {
    throw new CurationRecordError(0, 'network_error')
  }
  if (!response.ok) throw new CurationRecordError(response.status, await failureCode(response))
  return response.json() as Promise<T>
}

/**
 * Keeps the collection links the page can render: a link with no id or title
 * cannot be shown as a link, and inventing either would be a lie about the
 * Curation's published presence.
 */
function toCollectionLinks(value: unknown): CurationCollectionLink[] {
  if (!Array.isArray(value)) return []
  const links: CurationCollectionLink[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const collectionId = asString(entry.collection_id)
    const title = asString(entry.title)
    if (collectionId === null || title === null) continue
    const published = entry.current_published_version
    links.push({
      collection_id: collectionId,
      slug: asString(entry.slug) ?? collectionId,
      title,
      current_published_version: typeof published === 'number' ? published : null,
    })
  }
  return links
}

/** `GET /api/admin/v1/records/curations/:id` from the browser. */
export const loadCurationRecordFromBff: LoadCurationRecord = async (curationId) => {
  const body = await requestJson<{ record?: unknown; collections?: unknown }>(recordPath(curationId), {
    method: 'GET',
  })
  return {
    record: isRecord(body.record) ? body.record : {},
    collections: toCollectionLinks(body.collections),
  } satisfies CurationRecordResponse
}

/**
 * `PATCH /api/admin/v1/records/curations/:id` from the browser. The body is the
 * plan's optimistic PATCH: only the touched top-level keys, plus the version the
 * editor opened — a 409 comes back as a `CurationRecordError` the page surfaces
 * as a conflict instead of swallowing.
 */
export const saveCurationRecordToBff: SaveCurationRecord = async ({ curationId, updates, expectedVersion }) => {
  const body = await requestJson<{ record?: unknown }>(recordPath(curationId), {
    method: 'PATCH',
    body: JSON.stringify({ updates, expectedVersion }),
  })
  return { record: isRecord(body.record) ? body.record : {} }
}
