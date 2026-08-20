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
