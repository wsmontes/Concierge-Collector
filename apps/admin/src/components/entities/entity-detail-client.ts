/**
 * Browser client for the Entity full-record page.
 *
 * The three BFF routes are the page's whole contract — the Admin never reaches
 * the domain API directly. Paths are hard-coded here and only here, so a test
 * can inject a loader instead of standing up HTTP.
 */

import type { LoadEntityRecord, SaveEntityRecord } from '../../content/record-types'
import { isRecord } from '../../content/value-guards'

export const ENTITY_RECORDS_PATH = '/api/admin/v1/records/entities'

export interface EntityCurationsPage {
  items: Record<string, unknown>[]
  total: number
}

/** `GET /api/admin/v1/records/entities/:id/curations` */
export type LoadEntityCurations = (entityId: string) => Promise<EntityCurationsPage>

/**
 * One ranked Entity image as the BFF serves it. `url` is a path on the BFF
 * itself — the browser holds a CMS session cookie, never the service key the
 * boundary requires — and it is the only address for the image the browser is
 * given: the origin URL the collector resolved stays on the server.
 */
export interface EntityImage {
  rank: number
  source: string
  url: string
}

export interface EntityImagesPage {
  items: EntityImage[]
}

/** `GET /api/admin/v1/records/entities/:id/images` */
export type LoadEntityImages = (entityId: string) => Promise<EntityImagesPage>

export interface EntityDetailClient {
  loadRecord: LoadEntityRecord
  saveRecord: SaveEntityRecord
  loadCurations: LoadEntityCurations
  loadImages: LoadEntityImages
}

/**
 * BFF failure carrying the `{ status, code }` shape `isAdminRequestFailure`
 * narrows, so the page can branch on 404 and 409 without guessing.
 */
export class EntityDetailError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.name = 'EntityDetailError'
    this.status = status
    this.code = code
  }
}

function failureCode(body: unknown, status: number): string {
  const fallback = `http_${status}`
  if (!isRecord(body)) return fallback
  const error = body.error
  if (!isRecord(error)) return fallback
  return typeof error.code === 'string' ? error.code : fallback
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body !== undefined && init.body !== null) headers.set('Content-Type', 'application/json')

  let response: Response
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin', headers })
  } catch {
    throw new EntityDetailError(0, 'network_error')
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new EntityDetailError(response.status, failureCode(body, response.status))
  }
  return response.json()
}

function recordFrom(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload) || !isRecord(payload.record)) {
    throw new EntityDetailError(0, 'invalid_response')
  }
  return payload.record
}

function curationsFrom(payload: unknown): EntityCurationsPage {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new EntityDetailError(0, 'invalid_response')
  }
  const list: readonly unknown[] = payload.items
  const items: Record<string, unknown>[] = []
  for (const item of list) {
    if (isRecord(item)) items.push(item)
  }
  return { items, total: typeof payload.total === 'number' ? payload.total : items.length }
}

function recordPath(entityId: string): string {
  return `${ENTITY_RECORDS_PATH}/${encodeURIComponent(entityId)}`
}

/**
 * The gallery the UI can render: an item without a rank, a source and a URL the
 * browser can fetch is not a thumbnail, so it is dropped rather than rendered
 * as a nameless or broken frame.
 */
function imagesFrom(payload: unknown): EntityImagesPage {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new EntityDetailError(0, 'invalid_response')
  }
  const items: EntityImage[] = []
  for (const item of payload.items) {
    if (!isRecord(item)) continue
    if (typeof item.rank !== 'number' || typeof item.source !== 'string' || typeof item.url !== 'string') continue
    items.push({ rank: item.rank, source: item.source, url: item.url })
  }
  return { items }
}

export function createBrowserEntityDetailClient(): EntityDetailClient {
  return {
    async loadRecord(entityId) {
      return { record: recordFrom(await requestJson(recordPath(entityId))) }
    },

    async saveRecord(input) {
      const payload = await requestJson(recordPath(input.entityId), {
        method: 'PATCH',
        body: JSON.stringify({ updates: input.updates, expectedVersion: input.expectedVersion }),
      })
      return { record: recordFrom(payload) }
    },

    async loadCurations(entityId) {
      return curationsFrom(await requestJson(`${recordPath(entityId)}/curations`))
    },

    async loadImages(entityId) {
      return imagesFrom(await requestJson(`${recordPath(entityId)}/images`))
    },
  }
}

export const browserEntityDetailClient = createBrowserEntityDetailClient()
