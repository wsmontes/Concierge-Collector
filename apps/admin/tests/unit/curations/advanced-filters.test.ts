import { describe, expect, test } from 'vitest'
import {
  hashNormalizedFilters,
  normalizeCurationFilters,
  normalizeWhereClauses,
} from '../../../src/explorer/normalize-filters'
import { parseCurationListState, serializeCurationListState } from '../../../src/explorer/url-state'
import type { WhereOperator } from '../../../src/explorer/types'

describe('advanced filter clauses', () => {
  test('canonicalizes order and duplicates so the intent hash stays stable', async () => {
    const first = normalizeCurationFilters({}, [
      { field: ' curator_type ', op: 'equals', value: 'synthetic' },
      { field: 'notes.private', op: 'contains', value: 'anniversary' },
      { field: 'notes.private', op: 'contains', value: 'anniversary' },
    ])
    const second = normalizeCurationFilters({}, [
      { field: 'notes.private', op: 'contains', value: 'anniversary' },
      { field: 'curator_type', op: 'equals', value: 'synthetic' },
    ])

    expect(first).toEqual(second)
    expect(first.where).toEqual([
      { field: 'curator_type', op: 'equals', value: 'synthetic' },
      { field: 'notes.private', op: 'contains', value: 'anniversary' },
    ])
    await expect(hashNormalizedFilters(first)).resolves.toBe(await hashNormalizedFilters(second))
  })

  test('hashes clause sets that differ in value or operator differently', async () => {
    const contains = normalizeCurationFilters({}, [{ field: 'notes.private', op: 'contains', value: 'anniversary' }])
    const equals = normalizeCurationFilters({}, [{ field: 'notes.private', op: 'equals', value: 'anniversary' }])
    const otherValue = normalizeCurationFilters({}, [{ field: 'notes.private', op: 'contains', value: 'birthday' }])

    expect(await hashNormalizedFilters(contains)).not.toBe(await hashNormalizedFilters(equals))
    expect(await hashNormalizedFilters(contains)).not.toBe(await hashNormalizedFilters(otherValue))
  })

  test('drops the value of the operators that take none', () => {
    expect(normalizeWhereClauses([
      { field: 'sources.audio', op: 'exists', value: '' },
      { field: 'entity_id', op: 'is_empty', value: 'stale draft' },
      { field: 'catalog_sequence', op: 'not_exists', value: 3 },
      { field: 'transcript', op: 'is_not_empty', value: ['x'] },
    ])).toEqual([
      { field: 'catalog_sequence', op: 'not_exists' },
      { field: 'entity_id', op: 'is_empty' },
      { field: 'sources.audio', op: 'exists' },
      { field: 'transcript', op: 'is_not_empty' },
    ])
  })

  test('drops clauses without a field and operators the wire does not know', () => {
    expect(normalizeWhereClauses([
      { field: '   ', op: 'equals', value: 'x' },
      { field: 'city', op: 'matches' as WhereOperator, value: 'x' },
    ])).toEqual([])
  })

  test('keeps unlinked only while it narrows the list', () => {
    expect(normalizeCurationFilters({ unlinked: false })).toEqual({})
    expect(normalizeCurationFilters({ unlinked: true })).toEqual({ unlinked: true })
  })
})

describe('advanced filter URL state', () => {
  const clause = { field: 'curator_type', op: 'equals', value: 'synthetic' } as const

  test('round-trips clauses and unlinked through the query string', () => {
    const state = parseCurationListState(`where=${encodeURIComponent(JSON.stringify(clause))}&unlinked=true`)
    const params = new URLSearchParams(serializeCurationListState(state))

    expect(state.where).toEqual([clause])
    expect(state.unlinked).toBe(true)
    expect(params.getAll('where')).toEqual([JSON.stringify(clause)])
    expect(params.get('unlinked')).toBe('true')
    expect(parseCurationListState(serializeCurationListState(state))).toEqual(state)
  })

  test('writes one where parameter per clause and drops malformed ones', () => {
    const state = parseCurationListState([
      'where=not-json',
      'where=42',
      `where=${encodeURIComponent('{"field":"city","op":"bogus"}')}`,
      `where=${encodeURIComponent('{"op":"equals"}')}`,
      `where=${encodeURIComponent('{"field":"sources.audio","op":"exists","value":"stale"}')}`,
      `where=${encodeURIComponent('{"field":"city","op":"equals","value":"Victoria"}')}`,
    ].join('&'))

    expect(state.where).toEqual([
      { field: 'city', op: 'equals', value: 'Victoria' },
      { field: 'sources.audio', op: 'exists' },
    ])
    expect(new URLSearchParams(serializeCurationListState(state)).getAll('where')).toEqual([
      '{"field":"city","op":"equals","value":"Victoria"}',
      '{"field":"sources.audio","op":"exists"}',
    ])
  })

  test('keeps a conjunction of clauses on one field and a list value', () => {
    const state = parseCurationListState([
      `where=${encodeURIComponent('{"field":"notes.private","op":"contains","value":"anniversary"}')}`,
      `where=${encodeURIComponent('{"field":"notes.private","op":"contains","value":"birthday"}')}`,
      `where=${encodeURIComponent('{"field":"categories.Mood","op":"contains_any","value":["Casual","Business"]}')}`,
    ].join('&'))

    expect(state.where).toEqual([
      { field: 'categories.Mood', op: 'contains_any', value: ['Casual', 'Business'] },
      { field: 'notes.private', op: 'contains', value: 'anniversary' },
      { field: 'notes.private', op: 'contains', value: 'birthday' },
    ])
    expect(parseCurationListState(serializeCurationListState(state))).toEqual(state)
  })

  test('omits both keys when the URL does not carry them', () => {
    const state = parseCurationListState('city=Victoria')

    expect(state.where).toEqual([])
    expect(state.unlinked).toBe(false)
    expect(serializeCurationListState(state)).toBe('city=Victoria')
  })

  test('drops a stale unlinked flag the parser does not read as true', () => {
    expect(parseCurationListState('unlinked=false').unlinked).toBe(false)
    expect(serializeCurationListState({ ...parseCurationListState(''), unlinked: false })).toBe('')
  })
})
