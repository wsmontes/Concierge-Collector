/**
 * One whole Curation/Entity record as the Admin receives it.
 *
 * `record` stays structurally open on purpose: the editorial surfaces must
 * render fields the Admin has no component for (legacy and future ones), so no
 * projection is applied on this side.
 */
export interface ContentRecord {
  kind: 'curation' | 'entity'
  id: string
  record: Record<string, unknown>
}

export class ContentRecordError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
    this.name = 'ContentRecordError'
  }
}

export interface ContentRecordClient {
  curation(curationId: string): Promise<ContentRecord>
  entity(entityId: string): Promise<ContentRecord>
  /**
   * Writes dotted field paths on one Curation. `version` is the version the
   * editor loaded; the server rejects the write with 409 when it moved.
   */
  patchCuration(curationId: string, fields: Record<string, unknown>, version: number): Promise<ContentRecord>
}

async function read(fetcher: typeof fetch, path: string, init: RequestInit = {}): Promise<ContentRecord> {
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
    throw new ContentRecordError(
      typeof body?.error?.code === 'string' ? body.error.code : `http_${response.status}`,
      response.status,
    )
  }
  return response.json() as Promise<ContentRecord>
}

export function createContentRecordClient(fetcher: typeof fetch = fetch): ContentRecordClient {
  return {
    curation: (curationId) => read(fetcher, `/api/admin/v1/curations/${encodeURIComponent(curationId)}`),
    entity: (entityId) => read(fetcher, `/api/admin/v1/entities/${encodeURIComponent(entityId)}`),
    patchCuration: (curationId, fields, version) => read(
      fetcher,
      `/api/admin/v1/curations/${encodeURIComponent(curationId)}`,
      { method: 'PATCH', body: JSON.stringify({ fields }), headers: { 'If-Match': String(version) } },
    ),
  }
}
