export interface CurationFilters {
  q?: string | null
  status?: string[]
  city?: string | null
  entity_type?: string | null
  curator_id?: string | null
}

export interface NormalizedCurationFilters {
  q?: string
  status?: string[]
  city?: string
  entity_type?: string
  curator_id?: string
}

/** Minimal, allowlisted row returned by the Catalog boundary. */
export interface AdminCurationRow {
  catalog_sequence: number
  curation_id: string
  status: string
  restaurant_name: string | null
  city: string | null
  entity_type: string | null
  curator_id: string | null
  updated_at: string | null
}

export interface CurationSearchPage {
  items: AdminCurationRow[]
  next_cursor: string | null
  total: number | null
}

export type SelectionState =
  | { mode: 'explicit'; selected: Set<string> }
  | { mode: 'all_matching'; filters: NormalizedCurationFilters; excluded: Set<string>; previewCount: number | null }
