import type { AdminCurationRow } from '../../src/explorer/types'

export function makeRows(count: number): AdminCurationRow[] {
  return Array.from({ length: count }, (_, index) => ({
    catalog_sequence: index + 1,
    curation_id: `curation-${index + 1}`,
    status: 'active',
    restaurant_name: `Restaurant ${index + 1}`,
    city: 'Vancouver',
    entity_type: 'restaurant',
    curator_id: 'admin-1',
    updated_at: null,
  }))
}

/** One catalog scan page exactly as the typed selection catalog boundary returns it. */
export interface CatalogScanPage {
  items: Array<{ curation_id: string }>
  next_cursor: string | null
}

export function page(ids: string[], nextCursor: string | null): CatalogScanPage {
  return { items: ids.map((curation_id) => ({ curation_id })), next_cursor: nextCursor }
}

/**
 * Worker lease handed to manifest materialization. Only `owner` is consumed at
 * claim time; `fencingToken` mirrors the server-owned manifest fencing counter.
 */
export interface JobLease {
  owner: string
  fencingToken: number
}

export function lease(overrides: Partial<JobLease> = {}): JobLease {
  return { owner: 'cms-admin-worker', fencingToken: 0, ...overrides }
}
