import { expect, test } from 'vitest'
import {
  buildSearchGroups,
  collectionHref,
  curationHref,
  entityHref,
  flattenSearchGroups,
} from '../../../../src/components/search/search-rows'
import type { CollectionHit, SearchResults } from '../../../../src/components/search/search-types'
import type { EntityRow } from '../../../../src/content/record-types'
import type { AdminCurationRow } from '../../../../src/explorer/types'

function entity(overrides: Partial<EntityRow> = {}): EntityRow {
  return {
    id: 'rest_1',
    entity_id: 'ent-1',
    name: 'Ritz Restaurant',
    type: 'restaurant',
    status: 'active',
    city: 'São Paulo',
    updated_at: null,
    version: 3,
    curations_count: 2,
    ...overrides,
  }
}

function curation(overrides: Partial<AdminCurationRow> = {}): AdminCurationRow {
  return {
    catalog_sequence: 12,
    curation_id: 'cur_1',
    status: 'active',
    restaurant_name: 'Ritz Restaurant',
    city: 'São Paulo',
    entity_type: 'restaurant',
    curator_id: 'usr_1',
    updated_at: null,
    ...overrides,
  }
}

function collection(overrides: Partial<CollectionHit> = {}): CollectionHit {
  return {
    id: 'col_1',
    slug: 'victoria',
    title: 'Victoria picks',
    lifecycle: 'published',
    draftSelectedCount: 3,
    ...overrides,
  }
}

function results(overrides: Partial<SearchResults> = {}): SearchResults {
  return { entities: [], curations: [], collections: [], ...overrides }
}

test('omits a family with no hit and keeps the reading order', () => {
  const groups = buildSearchGroups(results({ collections: [collection()], entities: [entity()] }))

  expect(groups.map((group) => group.title)).toEqual(['ENTITIES', 'COLLECTIONS'])
  expect(flattenSearchGroups(groups).map((row) => row.kind)).toEqual(['entity', 'collection'])
  // The omitted family leaves no hole: the keyboard walks 0, 1.
  expect(flattenSearchGroups(groups).map((row) => row.index)).toEqual([0, 1])
})

test('an Entity row leads with its name and carries type and city as facets', () => {
  const [entityRow] = flattenSearchGroups(buildSearchGroups(results({ entities: [entity()] })))

  expect(entityRow.label).toBe('Ritz Restaurant')
  expect(entityRow.meta).toBe('restaurant · São Paulo')
  expect(entityRow.id).toBe('rest_1')
  expect(entityRow.href).toBe('/admin/entities/rest_1')
  expect(entityRow.label).not.toBe(entityRow.id)
})

test('facets the record does not carry drop out instead of rendering blanks', () => {
  const [entityRow] = flattenSearchGroups(buildSearchGroups(results({
    entities: [entity({ city: null, type: '' })],
  })))
  const [curationRow] = flattenSearchGroups(buildSearchGroups(results({
    curations: [curation({ entity_type: null, city: null })],
  })))

  expect(entityRow.meta).toBe('')
  expect(curationRow.meta).toBe('active')
})

test('a Curation without a restaurant name falls back to a label, never to its id', () => {
  const [row] = flattenSearchGroups(buildSearchGroups(results({
    curations: [curation({ restaurant_name: null })],
  })))

  expect(row.label).toBe('Untitled curation')
  expect(row.id).toBe('cur_1')
  expect(row.meta).toBe('restaurant · active · São Paulo')
  expect(row.href).toBe('/admin/curations/cur_1')
})

test('a Collection row leads with its title and counts its draft selections', () => {
  const [titled] = flattenSearchGroups(buildSearchGroups(results({ collections: [collection()] })))
  const [untitled] = flattenSearchGroups(buildSearchGroups(results({
    collections: [collection({ title: '' })],
  })))

  expect(titled).toMatchObject({ label: 'Victoria picks', meta: 'victoria · 3 in draft' })
  expect(titled.href).toBe('/admin/collections/collections/col_1')
  // A nameless Collection still leads with the human handle, and the id stays detail.
  expect(untitled.label).toBe('victoria')
  expect(untitled.id).toBe('col_1')
})

test('hrefs encode the id instead of interpolating it raw', () => {
  expect(entityHref('rest 1/x')).toBe('/admin/entities/rest%201%2Fx')
  expect(curationHref('cur 1/x')).toBe('/admin/curations/cur%201%2Fx')
  expect(collectionHref('col 1/x')).toBe('/admin/collections/collections/col%201%2Fx')
})
