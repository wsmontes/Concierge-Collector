/**
 * URL ⇄ list state for the Curations surface (plan §28).
 *
 * The query string is what a refresh, a back/forward step, a new tab or a
 * pasted link reproduces, so every field the list depends on lives here. Only
 * the keys this module owns are rewritten: an unknown key a caller added (the
 * Collection target, an embed flag, …) is preserved verbatim.
 */

import { DEFAULT_CURATION_COLUMNS, normalizeCurationColumns, type CurationColumnId } from '../content/curation-columns'
import type { CurationSort } from '../content/record-types'
import { isRecord } from '../content/value-guards'
import { normalizeConceptFilters, normalizeWhereClauses } from './normalize-filters'
import {
  DEFAULT_CURATION_SORT,
  isCurationSort,
  isWhereOperator,
  type CurationConceptFilter,
  type WhereClause,
} from './types'

const CONCEPT_PREFIX = 'concept.'

const MANAGED_KEY: Record<string, true | undefined> = {
  q: true,
  status: true,
  city: true,
  entity_type: true,
  curator_id: true,
  unlinked: true,
  where: true,
  sort: true,
  columns: true,
  cursor: true,
}

export interface CurationListState {
  q: string | null
  status: string[]
  city: string | null
  entity_type: string | null
  curator_id: string | null
  unlinked: boolean
  concepts: CurationConceptFilter[]
  where: WhereClause[]
  sort: CurationSort
  columns: CurationColumnId[]
  cursor: string | null
}

function paramsOf(search: string | URLSearchParams | null | undefined): URLSearchParams {
  if (!search) return new URLSearchParams()
  if (search instanceof URLSearchParams) return search
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
}

function trimmed(value: string | null): string | null {
  const next = value?.trim()
  return next ? next : null
}

function canonicalStatus(status: readonly string[]): string[] {
  return [...new Set(status.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort()
}

function conceptFiltersOf(params: URLSearchParams): CurationConceptFilter[] {
  const concepts: CurationConceptFilter[] = []
  for (const [key, value] of params) {
    if (key.startsWith(CONCEPT_PREFIX)) concepts.push({ category: key.slice(CONCEPT_PREFIX.length), value })
  }
  return normalizeConceptFilters(concepts)
}

/**
 * One `where` parameter. A value the operator cannot carry, a foreign operator
 * or invalid JSON is dropped: a half-typed deep link must not break the list.
 */
function whereClauseOf(raw: string): WhereClause | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || typeof parsed.field !== 'string' || !isWhereOperator(parsed.op)) return null
  return parsed.value === undefined ? { field: parsed.field, op: parsed.op } : { field: parsed.field, op: parsed.op, value: parsed.value }
}

function whereClausesOf(params: URLSearchParams): WhereClause[] {
  return parseWhereClauses(params.getAll('where'))
}

/**
 * Parses repeated `where` wire values into canonical clauses. The Admin BFF
 * reads the very same query string, so it parses the clauses with this one
 * function instead of growing a second, drifting spelling of the wire format.
 */
export function parseWhereClauses(values: readonly string[]): WhereClause[] {
  const clauses: WhereClause[] = []
  for (const raw of values) {
    const clause = whereClauseOf(raw)
    if (clause) clauses.push(clause)
  }
  return normalizeWhereClauses(clauses)
}

/**
 * One `where` wire value. `undefined` values are dropped by `JSON.stringify`,
 * which is exactly the spelling the valueless operators need (`{"field","op"}`).
 */
export function whereParameter(clause: WhereClause): string {
  return JSON.stringify({ field: clause.field, op: clause.op, value: clause.value })
}

/** A URL that names the editorial defaults stays clean: absent means default. */
function isDefaultColumnSet(columns: readonly CurationColumnId[]): boolean {
  return columns.join(',') === DEFAULT_CURATION_COLUMNS.join(',')
}

/**
 * Reads the list state out of a query string. `fallbackColumns` seeds the
 * column set when the URL does not carry one (the server hands the account's
 * preference to the surface); the URL always wins over it.
 *
 * The absent case passes `DEFAULT_CURATION_COLUMNS` explicitly: the canonical
 * normalizer only returns its default set when nothing survives, so an empty
 * input would otherwise collapse to the fixed column alone.
 */
export function parseCurationListState(
  search: string | URLSearchParams | null | undefined,
  fallbackColumns: readonly CurationColumnId[] | null = null,
): CurationListState {
  const params = paramsOf(search)
  const rawSort = params.get('sort')
  const rawColumns = params.get('columns')?.trim()
  return {
    q: trimmed(params.get('q')),
    status: canonicalStatus(params.getAll('status')),
    city: trimmed(params.get('city')),
    entity_type: trimmed(params.get('entity_type')),
    curator_id: trimmed(params.get('curator_id')),
    unlinked: params.get('unlinked') === 'true',
    concepts: conceptFiltersOf(params),
    where: whereClausesOf(params),
    sort: rawSort && isCurationSort(rawSort) ? rawSort : DEFAULT_CURATION_SORT,
    columns: normalizeCurationColumns(rawColumns ? rawColumns.split(',') : fallbackColumns ?? DEFAULT_CURATION_COLUMNS),
    cursor: trimmed(params.get('cursor')),
  }
}

function managed(key: string): boolean {
  return MANAGED_KEY[key] === true || key.startsWith(CONCEPT_PREFIX)
}

/**
 * Writes the list state back into a query string, re-emitting every unknown
 * key of `preserved` first so foreign deep links survive.
 */
export function serializeCurationListState(
  state: CurationListState,
  preserved: string | URLSearchParams | null = null,
): string {
  const params = new URLSearchParams()
  for (const [key, value] of paramsOf(preserved)) {
    if (!managed(key)) params.append(key, value)
  }
  const q = trimmed(state.q)
  if (q) params.set('q', q)
  for (const status of canonicalStatus(state.status)) params.append('status', status)
  const city = trimmed(state.city)
  if (city) params.set('city', city)
  const entityType = trimmed(state.entity_type)
  if (entityType) params.set('entity_type', entityType)
  const curatorId = trimmed(state.curator_id)
  if (curatorId) params.set('curator_id', curatorId)
  for (const concept of normalizeConceptFilters(state.concepts)) {
    // Repeated keys, not `set`: one category can carry a conjunction of values
    // (`concept.Mood=Casual&concept.Mood=Business`).
    params.append(`${CONCEPT_PREFIX}${concept.category}`, concept.value)
  }
  // One `where` key per clause, always the canonical `{field, op, value}` JSON:
  // the clause set is what the selection intent hashes, so the spelling of the
  // URL must not drift from the spelling the BFF forwards.
  for (const clause of normalizeWhereClauses(state.where)) {
    params.append('where', whereParameter(clause))
  }
  if (state.unlinked) params.set('unlinked', 'true')
  if (state.sort !== DEFAULT_CURATION_SORT) params.set('sort', state.sort)
  const columns = normalizeCurationColumns(state.columns)
  if (!isDefaultColumnSet(columns)) params.set('columns', columns.join(','))
  const cursor = trimmed(state.cursor)
  if (cursor) params.set('cursor', cursor)
  return params.toString()
}
