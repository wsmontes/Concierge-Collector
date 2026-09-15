import { describe, expect, test } from 'vitest'
import { parseCurationListState, serializeCurationListState } from '../../../src/explorer/url-state'

describe('Curation list URL state', () => {
  test('round-trips filters, concepts, sort, columns and cursor', () => {
    const query = [
      'q=sushi',
      'status=active',
      'status=draft',
      'city=Victoria',
      'entity_type=restaurant',
      'curator_id=admin-1',
      'concept.Mood=Casual',
      'sort=name_asc',
      'columns=curation,city,created',
      'cursor=abc',
    ].join('&')

    const state = parseCurationListState(query)

    expect(state).toEqual({
      q: 'sushi',
      status: ['active', 'draft'],
      city: 'Victoria',
      entity_type: 'restaurant',
      curator_id: 'admin-1',
      unlinked: false,
      without_collections: false,
      concepts: [{ category: 'Mood', value: 'Casual' }],
      where: [],
      sort: 'name_asc',
      columns: ['curation', 'city', 'created'],
      cursor: 'abc',
    })
    expect(parseCurationListState(serializeCurationListState(state))).toEqual(state)
  })

  test('round-trips the "Without Collections" view mode', () => {
    const state = parseCurationListState('without_collections=true&city=Victoria')

    expect(state.without_collections).toBe(true)
    expect(serializeCurationListState(state)).toBe('city=Victoria&without_collections=true')
    expect(parseCurationListState(serializeCurationListState(state)).without_collections).toBe(true)
  })

  test('keeps the view mode out of a URL that did not ask for it', () => {
    expect(parseCurationListState('without_collections=false').without_collections).toBe(false)
    expect(serializeCurationListState(parseCurationListState(''))).toBe('')
  })

  test('serializes concept facets as repeated concept.<Category> keys', () => {
    const state = parseCurationListState('concept.Mood=Casual&concept.Cuisine=Italian')
    const serialized = serializeCurationListState(state)

    expect(serialized).toBe('concept.Cuisine=Italian&concept.Mood=Casual')
    expect(parseCurationListState(serialized).concepts).toEqual([
      { category: 'Cuisine', value: 'Italian' },
      { category: 'Mood', value: 'Casual' },
    ])
  })

  test('keeps foreign query keys and drops its own stale ones', () => {
    const state = parseCurationListState('city=Old')
    const serialized = serializeCurationListState({ ...state, city: 'São Paulo' }, 'collection=abc123&embed=1&city=Old')

    expect(serialized).toBe('collection=abc123&embed=1&city=S%C3%A3o+Paulo')
    expect(serializeCurationListState(state, 'columns=curation,created')).not.toContain('columns=')
  })

  test('omits defaults from the URL and falls back to them when reading', () => {
    const state = parseCurationListState('')

    expect(state.sort).toBe('updated_at_desc')
    expect(state.columns).toEqual(['curation', 'entity', 'curator', 'type', 'city', 'concepts', 'collections', 'state', 'updated'])
    expect(serializeCurationListState(state)).toBe('')
  })

  test('normalizes columns through the canonical vocabulary', () => {
    expect(parseCurationListState('columns=bogus,created').columns).toEqual(['curation', 'created'])
    expect(serializeCurationListState(parseCurationListState('columns=created'))).toBe('columns=curation%2Ccreated')
  })

  test('round-trips a conjunction of values inside one concept category', () => {
    const state = parseCurationListState('concept.Mood=Casual&concept.Mood=Business')

    expect(state.concepts).toEqual([
      { category: 'Mood', value: 'Business' },
      { category: 'Mood', value: 'Casual' },
    ])
    expect(serializeCurationListState(state)).toBe('concept.Mood=Business&concept.Mood=Casual')
    expect(parseCurationListState(serializeCurationListState(state))).toEqual(state)
  })

  test('canonicalizes repeated status values and concept facets', () => {
    const state = parseCurationListState('status=Draft&status=active&status=draft&concept.Mood=Lively&concept.Mood=Lively')

    expect(state.status).toEqual(['active', 'draft'])
    expect(state.concepts).toEqual([{ category: 'Mood', value: 'Lively' }])
  })

  test('the URL wins over the server-provided column preference', () => {
    expect(parseCurationListState('city=Victoria', ['curation', 'created']).columns).toEqual(['curation', 'created'])
    expect(parseCurationListState('columns=curation,updated', ['curation', 'created']).columns).toEqual(['curation', 'updated'])
  })

  test('ignores an unknown sort instead of sending it upstream', () => {
    const state = parseCurationListState('sort=-updatedAt')

    expect(state.sort).toBe('updated_at_desc')
    expect(serializeCurationListState(state)).toBe('')
  })
})
