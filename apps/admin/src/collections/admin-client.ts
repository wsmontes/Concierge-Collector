import type { CollectionDraftState, CollectionLifecycle } from './types'

export interface AdminCollectionRecord {
  id: string
  slug: string
  title: string
  description: string | null
  lifecycle: CollectionLifecycle
  currentPublishedVersion: number | null
  draftRevision: number
  draftState: CollectionDraftState
  publishedSelectedCount: number
  draftSelectedCount: number
  revision: number
}

export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
}

export interface MemberRowDto { curationId: string; available?: boolean; reasonCode?: string }
export interface DraftDiffRowDto { curationId: string; desiredState: 'add' | 'remove'; operationId: string }
export interface VersionRowDto { version: number; selectedCount: number; membershipHash: string; publishedAt?: string }
export interface ActivityRowDto { eventType: string; actorId: string; createdAt: string }

export interface PublishPreviewDto {
  currentPublishedVersion: number | null
  nextVersion: number
  draftRevision: number
  revision: number
  selectedCount: number
  availableCount: number
  unavailableCount: number
  addCount: number
  removeCount: number
}

export interface PublishJobDto { id: string; status: string }

export class CollectionsAdminError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly details: Record<string, string> = {},
  ) {
    super(code)
    this.name = 'CollectionsAdminError'
  }
}

export interface CollectionsAdminClient {
  list(): Promise<AdminCollectionRecord[]>
  get(collectionId: string): Promise<AdminCollectionRecord>
  create(input: { slug: string; title: string; description?: string | null }, commandId?: string): Promise<AdminCollectionRecord>
  patchMetadata(collection: AdminCollectionRecord, input: { title?: string; description?: string | null }): Promise<AdminCollectionRecord>
  archive(collection: AdminCollectionRecord): Promise<AdminCollectionRecord>
  restore(collection: AdminCollectionRecord): Promise<AdminCollectionRecord>
  publishPreview(collectionId: string): Promise<PublishPreviewDto>
  publish(collection: AdminCollectionRecord, input: { confirmUnavailable: boolean; expectedUnavailableCount?: number }, commandId?: string): Promise<PublishJobDto>
  restoreVersionAsDraft(collectionId: string, version: number): Promise<Record<string, unknown>>
  members(collectionId: string, version: number, cursor?: string): Promise<CursorPage<MemberRowDto>>
  draftDiff(collectionId: string, cursor?: string): Promise<CursorPage<DraftDiffRowDto>>
  versions(collectionId: string, cursor?: string): Promise<CursorPage<VersionRowDto>>
  activity(collectionId: string, cursor?: string): Promise<CursorPage<ActivityRowDto>>
}

interface ClientDependencies { fetcher?: typeof fetch; uuid?: () => string }
type AdminErrorBody = { error?: { code?: unknown; [key: string]: unknown } }

function retryableStatus(status: number): boolean { return status === 423 || status === 503 || status >= 500 }

function safeDetails(error: AdminErrorBody['error']): Record<string, string> {
  if (!error) return {}
  const details: Record<string, string> = {}
  for (const [key, value] of Object.entries(error)) {
    if (key !== 'code' && typeof value === 'string') details[key] = value
  }
  return details
}

function normalizeCollection(value: AdminCollectionRecord): AdminCollectionRecord {
  return {
    ...value,
    description: value.description ?? null,
    currentPublishedVersion: value.currentPublishedVersion ?? null,
    publishedSelectedCount: value.publishedSelectedCount ?? 0,
    draftSelectedCount: value.draftSelectedCount ?? 0,
  }
}

function withQuery(path: string, values: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined) query.set(key, String(value))
  const suffix = query.toString()
  return suffix ? `${path}?${suffix}` : path
}

export function createBrowserCollectionsAdminClient(dependencies: ClientDependencies = {}): CollectionsAdminClient {
  const fetcher = dependencies.fetcher ?? fetch
  const uuid = dependencies.uuid ?? (() => crypto.randomUUID())

  async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (!headers.has('Accept')) headers.set('Accept', 'application/json')
    if (init.body !== undefined && init.body !== null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

    let response: Response
    try {
      response = await fetcher(path, { ...init, credentials: 'same-origin', headers })
    } catch {
      throw new CollectionsAdminError('network_error', 0, true)
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null) as AdminErrorBody | null
      const error = body?.error
      const code = typeof error?.code === 'string' ? error.code : `http_${response.status}`
      throw new CollectionsAdminError(code, response.status, retryableStatus(response.status), safeDetails(error))
    }
    return response.json() as Promise<T>
  }

  function commandHeaders(options: { ifMatch?: number; idempotencyKey?: string } = {}): Headers {
    const headers = new Headers()
    headers.set('X-Request-Id', uuid())
    if (options.ifMatch !== undefined) headers.set('If-Match', String(options.ifMatch))
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
    return headers
  }

  return {
    async list() {
      const items: AdminCollectionRecord[] = []
      const seenCursors = new Set<string>()
      let cursor: string | undefined
      do {
        const result = await requestJson<CursorPage<AdminCollectionRecord>>(withQuery('/api/admin/v1/collections', { cursor }))
        items.push(...result.items.map(normalizeCollection))
        if (!result.nextCursor) break
        if (seenCursors.has(result.nextCursor)) throw new CollectionsAdminError('invalid_pagination', 0, false)
        seenCursors.add(result.nextCursor)
        cursor = result.nextCursor
      } while (true)
      return items
    },

    async get(collectionId) {
      return normalizeCollection(await requestJson<AdminCollectionRecord>(`/api/admin/v1/collections/${encodeURIComponent(collectionId)}`))
    },

    async create(input, commandId = uuid()) {
      const headers = commandHeaders({ idempotencyKey: commandId })
      return normalizeCollection(await requestJson<AdminCollectionRecord>('/api/admin/v1/collections', {
        method: 'POST', headers, body: JSON.stringify({ ...input, description: input.description ?? null }),
      }))
    },

    async patchMetadata(collection, input) {
      const headers = commandHeaders({ ifMatch: collection.revision, idempotencyKey: uuid() })
      return normalizeCollection(await requestJson<AdminCollectionRecord>(
        `/api/admin/v1/collections/${encodeURIComponent(collection.id)}`,
        { method: 'PATCH', headers, body: JSON.stringify(input) },
      ))
    },

    async archive(collection) {
      const headers = commandHeaders({ ifMatch: collection.revision, idempotencyKey: uuid() })
      return normalizeCollection(await requestJson<AdminCollectionRecord>(
        `/api/admin/v1/collections/${encodeURIComponent(collection.id)}/archive`,
        { method: 'POST', headers },
      ))
    },

    async restore(collection) {
      const headers = commandHeaders({ ifMatch: collection.revision, idempotencyKey: uuid() })
      return normalizeCollection(await requestJson<AdminCollectionRecord>(
        `/api/admin/v1/collections/${encodeURIComponent(collection.id)}/restore`,
        { method: 'POST', headers },
      ))
    },

    async publishPreview(collectionId) {
      return requestJson<PublishPreviewDto>(`/api/admin/v1/collections/${encodeURIComponent(collectionId)}/publish-preview`)
    },

    async publish(collection, input, commandId = uuid()) {
      const headers = commandHeaders({ ifMatch: collection.revision, idempotencyKey: commandId })
      return requestJson<PublishJobDto>(
        `/api/admin/v1/collections/${encodeURIComponent(collection.id)}/publish`,
        { method: 'POST', headers, body: JSON.stringify(input) },
      )
    },

    async restoreVersionAsDraft(collectionId, version) {
      return requestJson<Record<string, unknown>>(
        `/api/admin/v1/collections/${encodeURIComponent(collectionId)}/versions/${encodeURIComponent(String(version))}/restore-as-draft`,
        { method: 'POST', headers: commandHeaders() },
      )
    },

    async members(collectionId, version, cursor) {
      return requestJson<CursorPage<MemberRowDto>>(withQuery(
        `/api/admin/v1/collections/${encodeURIComponent(collectionId)}/members`, { version, cursor },
      ))
    },

    async draftDiff(collectionId, cursor) {
      return requestJson<CursorPage<DraftDiffRowDto>>(withQuery(
        `/api/admin/v1/collections/${encodeURIComponent(collectionId)}/draft/diff`, { cursor },
      ))
    },

    async versions(collectionId, cursor) {
      return requestJson<CursorPage<VersionRowDto>>(withQuery(
        `/api/admin/v1/collections/${encodeURIComponent(collectionId)}/versions`, { cursor },
      ))
    },

    async activity(collectionId, cursor) {
      return requestJson<CursorPage<ActivityRowDto>>(withQuery(
        `/api/admin/v1/collections/${encodeURIComponent(collectionId)}/activity`, { cursor },
      ))
    },
  }
}