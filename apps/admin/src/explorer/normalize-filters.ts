import { isRecord } from '../content/value-guards'
import {
  isValuelessWhereOperator,
  isWhereOperator,
  type CurationConceptFilter,
  type CurationFilters,
  type NormalizedCurationFilters,
  type WhereClause,
} from './types'

function trimmed(value: string | null | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

/**
 * Canonical concept facets: trimmed, de-duplicated, ordered by category then
 * value. Two callers that pass the same facets in a different order must hash
 * and compare equal, because the facets travel into selection intents.
 */
export function normalizeConceptFilters(
  concepts: readonly CurationConceptFilter[] | undefined,
): CurationConceptFilter[] {
  const unique = new Map<string, CurationConceptFilter>()
  for (const concept of concepts ?? []) {
    const category = concept.category.trim()
    const value = concept.value.trim()
    if (!category || !value) continue
    unique.set(`${category}\u0000${value}`, { category, value })
  }
  return [...unique.values()].sort((left, right) => {
    if (left.category !== right.category) return left.category < right.category ? -1 : 1
    if (left.value === right.value) return 0
    return left.value < right.value ? -1 : 1
  })
}

/**
 * Canonical sort and de-duplication key of one clause: `field`, `op` and the
 * JSON form of the value. Nothing else may enter it — two operators that differ
 * only in their value must stay two clauses.
 */
function whereKey(clause: WhereClause): string {
  return `${clause.field}\u0000${clause.op}\u0000${JSON.stringify(clause.value ?? null)}`
}

/**
 * Canonical advanced conditions: field trimmed, empty fields and unknown
 * operators dropped, valueless operators stripped of any draft value, ordered
 * by `(field, op, value)` and de-duplicated by that same key. The clause set
 * travels into the selection intent, so the result must be byte-stable.
 */
export function normalizeWhereClauses(where: readonly WhereClause[] | undefined): WhereClause[] {
  const unique = new Map<string, WhereClause>()
  for (const clause of where ?? []) {
    const field = clause.field.trim()
    if (!field || !isWhereOperator(clause.op)) continue
    const value = isValuelessWhereOperator(clause.op) ? undefined : clause.value
    const normalized: WhereClause = value === undefined ? { field, op: clause.op } : { field, op: clause.op, value }
    unique.set(whereKey(normalized), normalized)
  }
  return [...unique.values()].sort((left, right) => {
    const leftKey = whereKey(left)
    const rightKey = whereKey(right)
    return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1
  })
}

/**
 * Canonical input shared by list/search, select-all and eventual manifests.
 * `where` may be passed separately so a surface that keeps the advanced clause
 * set outside its flat draft still normalizes through this one entry point.
 */
export function normalizeCurationFilters(
  filters: CurationFilters,
  where?: readonly WhereClause[],
): NormalizedCurationFilters {
  const q = trimmed(filters.q)?.toLowerCase()
  const city = trimmed(filters.city)
  const entityType = trimmed(filters.entity_type)
  const curatorId = trimmed(filters.curator_id)
  const status = [...new Set((filters.status ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean))].sort()
  const concepts = normalizeConceptFilters(filters.concepts)
  const clauses = normalizeWhereClauses(where ?? filters.where)

  return {
    ...(q ? { q } : {}),
    ...(status.length ? { status } : {}),
    ...(city ? { city } : {}),
    ...(entityType ? { entity_type: entityType } : {}),
    ...(curatorId ? { curator_id: curatorId } : {}),
    // Absent means unrestricted: a `false` flag would be a second spelling of
    // the same thing and would make the intent hash depend on the draft.
    ...(filters.unlinked === true ? { unlinked: true } : {}),
    // Same rule for the view mode: it is only ever recorded when asked for.
    ...(filters.without_collections === true ? { without_collections: true } : {}),
    ...(concepts.length ? { concepts } : {}),
    ...(clauses.length ? { where: clauses } : {}),
  }
}

/**
 * Depth-aware canonical JSON. A plain `JSON.stringify(value, keys)` replacer
 * would also filter nested objects — collapsing every concept facet and every
 * clause to `{}` — so the keys are sorted by hand at every level.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Stable browser-safe key. It identifies an intent; it is not an authorization token. */
export async function hashNormalizedFilters(filters: NormalizedCurationFilters): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(filters)))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
