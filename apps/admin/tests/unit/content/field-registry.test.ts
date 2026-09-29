import { expect, test } from 'vitest'
import { CURATION_FIELDS, ENTITY_FIELDS, describeField } from '../../../src/content/field-registry'

const SECTIONS = ['about', 'identity', 'curation', 'concepts', 'media', 'relationships', 'history', 'system', 'other']

test('registers owned, unique fields with known sections', () => {
  for (const field of CURATION_FIELDS) {
    expect(field.owner, field.path).toBe('curation')
    expect(SECTIONS, field.path).toContain(field.section)
  }
  for (const field of ENTITY_FIELDS) {
    expect(field.owner, field.path).toBe('entity')
    expect(SECTIONS, field.path).toContain(field.section)
  }
  expect(new Set(CURATION_FIELDS.map((field) => field.path)).size).toBe(CURATION_FIELDS.length)
  expect(new Set(ENTITY_FIELDS.map((field) => field.path)).size).toBe(ENTITY_FIELDS.length)
})

test('describes registered fields with editorial semantics', () => {
  expect(describeField('curation', 'notes.public')).toMatchObject({
    path: 'notes.public',
    label: 'Public recommendation',
    owner: 'curation',
    type: 'longText',
    section: 'curation',
    editable: true,
  })
  expect(describeField('curation', 'status')).toMatchObject({ label: 'Curation status', type: 'enum' })
  expect(describeField('entity', 'name')).toMatchObject({ label: 'Name', owner: 'entity', type: 'text' })
})

test('marks curation city and type as entity-derived projections', () => {
  expect(describeField('curation', 'city')).toMatchObject({
    owner: 'curation',
    derivedIn: 'entity',
    editable: false,
  })
  expect(describeField('curation', 'type')).toMatchObject({ derivedIn: 'entity', editable: false })
})

test('marks system-managed paths as read-only', () => {
  const systemPaths = [
    '_id',
    'version',
    'catalog_sequence',
    'createdAt',
    'updatedAt',
    'createdBy',
    'updatedBy',
    'embeddings',
    'embeddings_metadata',
  ]

  for (const path of systemPaths) {
    expect(describeField('curation', path).system, path).toBe(true)
    expect(describeField('curation', path).editable, path).toBe(false)
  }
  expect(describeField('curation', 'notes.public').system).toBeUndefined()
  expect(describeField('entity', 'sync')).toMatchObject({ system: true, editable: false })
})

test('falls back to a json descriptor for unregistered paths', () => {
  expect(describeField('curation', 'legacy_field')).toEqual({
    path: 'legacy_field',
    label: 'Legacy field',
    owner: 'curation',
    type: 'json',
    section: 'other',
  })
  expect(describeField('entity', 'mystery.nested_id')).toEqual({
    path: 'mystery.nested_id',
    label: 'Nested ID',
    owner: 'entity',
    type: 'json',
    section: 'other',
  })
})

test('classifies dynamic category keys as concepts', () => {
  expect(describeField('curation', 'categories.Mood')).toMatchObject({
    path: 'categories.Mood',
    label: 'Mood',
    owner: 'curation',
    type: 'concept',
    section: 'concepts',
    searchable: true,
    filterable: true,
    editable: true,
  })
  expect(describeField('curation', 'categories')).toMatchObject({ type: 'object', section: 'concepts' })
  expect(describeField('entity', 'categories.Mood').type).toBe('json')
})
