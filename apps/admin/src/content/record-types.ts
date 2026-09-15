/**
 * Frozen contract between the Curations/Entities surfaces and the Admin BFF.
 *
 * Nothing here fetches: each loader is injected so a component can be rendered
 * against a page-level loader, the browser default, or a test double.
 */

/** Sort values accepted by `GET /api/admin/v1/curations?sort=`. */
export type CurationSort =
  | 'sequence_asc'
  | 'sequence_desc'
  | 'updated_at_desc'
  | 'updated_at_asc'
  | 'created_at_desc'
  | 'created_at_asc'
  | 'name_asc'
  | 'name_desc'

export const CURATION_SORTS: readonly { id: CurationSort; label: string }[] = [
  { id: 'updated_at_desc', label: 'Last updated (newest first)' },
  { id: 'updated_at_asc', label: 'Last updated (oldest first)' },
  { id: 'created_at_desc', label: 'Recently added' },
  { id: 'created_at_asc', label: 'First added' },
  { id: 'name_asc', label: 'Name (A–Z)' },
  { id: 'name_desc', label: 'Name (Z–A)' },
  { id: 'sequence_asc', label: 'Catalog sequence (oldest first)' },
  { id: 'sequence_desc', label: 'Catalog sequence (newest first)' },
]

export interface CurationCollectionLink {
  collection_id: string
  slug: string
  title: string
  current_published_version: number | null
}

/** `GET /api/admin/v1/records/curations/:id` */
export interface CurationRecordResponse {
  record: Record<string, unknown>
  collections: CurationCollectionLink[]
}

export type LoadCurationRecord = (curationId: string) => Promise<CurationRecordResponse>

/**
 * `PATCH /api/admin/v1/records/curations/:id`.
 *
 * `expectedVersion` is the `version` of the record the editor opened; the
 * backend answers 409 when the stored version moved on.
 */
export type SaveCurationRecord = (input: {
  curationId: string
  updates: Record<string, unknown>
  expectedVersion: number
}) => Promise<{ record: Record<string, unknown> }>

export interface EntityRow {
  id: string
  entity_id: string | null
  name: string
  type: string
  status: string
  city: string | null
  updated_at: string | null
  version: number | null
  curations_count: number | null
  /**
   * Collections currently holding any of this Entity's Curations, joined by the
   * BFF from the CMS membership ledger. `null` is unknown — the boundary did
   * not report the join input — and is never the same as zero.
   */
  collections_count: number | null
}

export interface EntitySearchPage {
  items: EntityRow[]
  next_cursor: string | null
  total: number | null
}

/** `GET /api/admin/v1/records/entities` */
export type LoadEntityPage = (input: {
  cursor: string | null
  query: string
  type: string | null
  status: string | null
  limit?: number
}) => Promise<EntitySearchPage>

/** `GET /api/admin/v1/records/entities/:id` */
export type LoadEntityRecord = (entityId: string) => Promise<{ record: Record<string, unknown> }>

/** `PATCH /api/admin/v1/records/entities/:id` */
export type SaveEntityRecord = (input: {
  entityId: string
  updates: Record<string, unknown>
  expectedVersion: number
}) => Promise<{ record: Record<string, unknown> }>

/** Failure shape returned by every Admin BFF route (`src/http/errors.ts`). */
export interface AdminRequestFailure {
  status: number
  code: string
}

/** Narrows a thrown loader failure so call sites can branch on 409 without guessing. */
export function isAdminRequestFailure(error: unknown): error is AdminRequestFailure {
  if (typeof error !== 'object' || error === null) return false
  return typeof (error as { status?: unknown }).status === 'number'
    && typeof (error as { code?: unknown }).code === 'string'
}
