/**
 * Curations filters as they travel through the URL.
 *
 * Filters used to live only in React state, so a refresh, Back, or a pasted link
 * lost the search. The shape matches the Explorer's filter draft so the URL can
 * seed it directly.
 */
export interface CurationListQuery {
  q?: string
  city?: string
  entity_type?: string
  curator_id?: string
  status?: string[]
}

function first(value: string | null): string | undefined {
  return value && value.length > 0 ? value : undefined
}

export function readCurationListQuery(source: URLSearchParams): CurationListQuery {
  const statuses = source.getAll('status').filter((status) => status.length > 0)
  return {
    q: first(source.get('q')),
    city: first(source.get('city')),
    entity_type: first(source.get('entity_type')),
    curator_id: first(source.get('curator_id')),
    ...(statuses.length > 0 ? { status: statuses } : {}),
  }
}

/** Serializes back to a query string, dropping empty filters so the URL stays readable. */
export function writeCurationListQuery(query: CurationListQuery): string {
  const params = new URLSearchParams()
  for (const key of ['q', 'city', 'entity_type', 'curator_id'] as const) {
    const value = query[key]
    if (value) params.set(key, value)
  }
  for (const status of query.status ?? []) params.append('status', status)
  return params.toString()
}
