import { CURATION_SORTS, type CurationSort } from '../content/record-types'

/** Sort the Curations list falls back to when the URL carries none. */
export const DEFAULT_CURATION_SORT: CurationSort = 'updated_at_desc'

export function isCurationSort(value: string): value is CurationSort {
  return CURATION_SORTS.some((entry) => entry.id === value)
}

/**
 * One `concept.<Category>=<value>` facet.
 *
 * Concepts are part of the filter object on purpose: an "all matching"
 * selection must carry the same predicate the list was filtered by, so the
 * server materializes exactly what the operator sees.
 */
export interface CurationConceptFilter {
  category: string
  value: string
}

/**
 * Advanced-field-search operators (plan §8). The vocabulary is frozen here
 * because a `where` clause travels into the selection intent: the URL, the BFF
 * allowlist and the builder must never disagree about an operator.
 */
export type WhereOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'greater_than'
  | 'less_than'
  | 'exists'
  | 'not_exists'
  | 'is_empty'
  | 'is_not_empty'
  | 'before'
  | 'after'
  | 'contains_any'
  | 'contains_all'

/** One `<field> <op> <value>` condition of the advanced field search. */
export interface WhereClause {
  field: string
  op: WhereOperator
  value?: unknown
}

/** Operators in the order the builder offers them, with the plan's wording. */
export const WHERE_OPERATORS: readonly { id: WhereOperator; label: string }[] = [
  { id: 'equals', label: 'equals' },
  { id: 'not_equals', label: 'does not equal' },
  { id: 'contains', label: 'contains' },
  { id: 'not_contains', label: 'does not contain' },
  { id: 'starts_with', label: 'starts with' },
  { id: 'greater_than', label: 'greater than' },
  { id: 'less_than', label: 'less than' },
  { id: 'exists', label: 'exists' },
  { id: 'not_exists', label: 'does not exist' },
  { id: 'is_empty', label: 'is empty' },
  { id: 'is_not_empty', label: 'is not empty' },
  { id: 'before', label: 'before' },
  { id: 'after', label: 'after' },
  { id: 'contains_any', label: 'contains any' },
  { id: 'contains_all', label: 'contains all' },
]

const OPERATOR_INDEX: Record<string, true | undefined> = Object.fromEntries(
  WHERE_OPERATORS.map((operator) => [operator.id, true]),
)

const OPERATOR_LABEL: Record<string, string> = Object.fromEntries(
  WHERE_OPERATORS.map((operator) => [operator.id, operator.label]),
)

export function isWhereOperator(value: unknown): value is WhereOperator {
  return typeof value === 'string' && OPERATOR_INDEX[value] === true
}

/** Human wording of one operator, derived from the single vocabulary above. */
export function operatorLabel(op: WhereOperator): string {
  return OPERATOR_LABEL[op] ?? op
}

/**
 * Operators that take no value. Their clauses must carry none, otherwise the
 * URL and the intent hash would depend on a stale draft value.
 */
const VALUELESS_OPERATOR: Record<WhereOperator, true | undefined> = {
  equals: undefined,
  not_equals: undefined,
  contains: undefined,
  not_contains: undefined,
  starts_with: undefined,
  greater_than: undefined,
  less_than: undefined,
  exists: true,
  not_exists: true,
  is_empty: true,
  is_not_empty: true,
  before: undefined,
  after: undefined,
  contains_any: undefined,
  contains_all: undefined,
}

export function isValuelessWhereOperator(op: WhereOperator): boolean {
  return VALUELESS_OPERATOR[op] === true
}

export interface CurationFilters {
  q?: string | null
  status?: string[]
  city?: string | null
  entity_type?: string | null
  curator_id?: string | null
  /** Only `true` narrows the list; an absent key means "no such restriction". */
  unlinked?: boolean
  concepts?: CurationConceptFilter[]
  where?: WhereClause[]
}

export interface NormalizedCurationFilters {
  q?: string
  status?: string[]
  city?: string
  entity_type?: string
  curator_id?: string
  unlinked?: boolean
  concepts?: CurationConceptFilter[]
  where?: WhereClause[]
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
  /**
   * Optional editorial projections. A row that does not carry one is rendered
   * as missing — the table never invents a value for it.
   */
  curator_name?: string | null
  concepts?: string[] | null
  created_at?: string | null
  source_count?: number | null
  image_count?: number | null
  audio_count?: number | null
  has_transcript?: boolean | null
  version?: number | null
  collections_count?: number | null
}

export interface CurationSearchPage {
  items: AdminCurationRow[]
  next_cursor: string | null
  total: number | null
}

/** Input of one list page. `sort` belongs to the list request only. */
export interface LoadCurationPageInput {
  cursor: string | null
  filters: CurationFilters
  sort?: CurationSort
}

export type LoadCurationPage = (input: LoadCurationPageInput) => Promise<CurationSearchPage>

export type SelectionState =
  | { mode: 'explicit'; selected: Set<string> }
  | { mode: 'all_matching'; filters: NormalizedCurationFilters; excluded: Set<string>; previewCount: number | null }
