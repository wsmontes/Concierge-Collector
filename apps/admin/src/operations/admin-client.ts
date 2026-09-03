export interface OperationCollectionRef {
  id: string
  title: string
  slug: string
}

export interface BulkOperationHistoryRow {
  id: string
  action: 'add' | 'remove'
  status: 'active' | 'completed' | 'failed'
  parentSummary: { active: number; completed: number; failed: number }
  progress: { processed: number; skipped: number; failed: number }
  cancellable: boolean
  collections: OperationCollectionRef[]
  createdAt: string
  updatedAt: string
}

export interface PublishJobHistoryRow {
  id: string
  collection: OperationCollectionRef
  targetVersion: number
  status: string
  checkpoint: string | null
  selectedCount: number | null
  confirmedUnavailableCount: number
  createdAt: string
  updatedAt: string
}

export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
}

export interface OperationsAdminClient {
  bulkOperations(cursor?: string): Promise<CursorPage<BulkOperationHistoryRow>>
  publishJobs(cursor?: string): Promise<CursorPage<PublishJobHistoryRow>>
  cancelOperation(operationId: string): Promise<void>
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ops-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function json<T>(fetcher: typeof fetch, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetcher(path, {
    ...init,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...init.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null
    throw new Error(typeof body?.error?.code === 'string' ? body.error.code : `http_${response.status}`)
  }
  return response.json() as Promise<T>
}

function pathWithCursor(path: string, cursor?: string): string {
  const query = new URLSearchParams({ actor: 'current' })
  if (cursor) query.set('cursor', cursor)
  return `${path}?${query.toString()}`
}

export function createBrowserOperationsAdminClient(
  fetcher: typeof fetch = fetch,
): OperationsAdminClient {
  return {
    bulkOperations(cursor) {
      return json<CursorPage<BulkOperationHistoryRow>>(
        fetcher,
        pathWithCursor('/api/admin/v1/operation-history', cursor),
      )
    },
    publishJobs(cursor) {
      return json<CursorPage<PublishJobHistoryRow>>(
        fetcher,
        pathWithCursor('/api/admin/v1/publish-jobs', cursor),
      )
    },
    async cancelOperation(operationId) {
      await json<Record<string, unknown>>(
        fetcher,
        `/api/admin/v1/operation-history/${encodeURIComponent(operationId)}/cancel`,
        { method: 'POST', headers: { 'X-Request-Id': requestId() } },
      )
    },
  }
}