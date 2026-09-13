import { expect, test } from 'vitest'
import { filterFields, flattenFields, inspectRecord } from '../../../src/content/record-inspector'
import type { FieldNode } from '../../../src/content/record-inspector'

const curation = {
  _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  curation_id: 'cur-1',
  catalog_sequence: 42,
  restaurant_name: 'Pujol',
  status: 'linked',
  city: 'Cidade do México',
  type: 'restaurant',
  notes: { public: 'Comer o mole.', private: 'Reservar com 1 mês.' },
  categories: { Mood: ['Romântico'], Cuisine: ['Mexicana'] },
  transcript: 'audio transcription',
  sources: { audio: [{ filename: 'a.m4a', duration: 91.5 }], image: [] },
  items: [{ name: 'Mole', confidence: 0.9 }],
  entity_id: 'entity-1',
  curator: { id: 'cur-1', name: 'Wagner', email: 'w@example.com' },
  curator_id: 'cur-1',
  curator_type: 'human',
  embeddings: [{ model: 'text-embedding-3-small', dimensions: 1536, created_at: '2026-01-01T00:00:00Z' }],
  embeddings_metadata: { model: 'text-embedding-3-small' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
  createdBy: 'cur-1',
  updatedBy: 'cur-2',
  version: 3,
  legacy_flag: true,
  unknown_note: null,
}

const entity = {
  _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  entity_id: 'entity-1',
  name: 'Pujol',
  type: 'restaurant',
  status: 'active',
  externalId: 'places/123',
  metadata: [{ type: 'google_places', source: 'places', data: { rating: 4.7 } }],
  sync: { status: 'synced', lastSyncedAt: '2026-02-01T00:00:00Z' },
  data: { location: { city: 'São Paulo', latitude: -23.5 }, contacts: { phone: '+55 11 0000-0000' } },
  location: { city: 'São Paulo' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
  version: 2,
}

function findNode(nodes: readonly FieldNode[], path: string): FieldNode {
  const node = flattenFields(nodes).find((candidate) => candidate.path === path)
  if (!node) throw new Error(`node ${path} not found`)
  return node
}

test('lists registered fields first, then unknown fields in document order', () => {
  const nodes = inspectRecord(curation, 'curation')

  expect(nodes.map((node) => node.path)).toEqual([
    '_id',
    'curation_id',
    'restaurant_name',
    'status',
    'city',
    'type',
    'notes',
    'categories',
    'transcript',
    'sources',
    'items',
    'entity_id',
    'curator',
    'curator_id',
    'curator_type',
    'createdAt',
    'updatedAt',
    'createdBy',
    'updatedBy',
    'version',
    'catalog_sequence',
    'embeddings',
    'embeddings_metadata',
    'legacy_flag',
    'unknown_note',
  ])
})

test('walks nested arrays of documents with indexed paths', () => {
  const nodes = inspectRecord(curation, 'curation')
  const audio = findNode(nodes, 'sources.audio.0')

  expect(audio.label).toBe('[0]')
  expect(audio.type).toBe('object')
  expect(audio.children.map((child) => child.path)).toEqual(['sources.audio.0.filename', 'sources.audio.0.duration'])
  expect(findNode(nodes, 'sources.audio.0.duration').type).toBe('number')
  expect(findNode(nodes, 'sources.audio.0.duration').leafCount).toBe(1)
  expect(findNode(nodes, 'sources').leafCount).toBe(3)
})

test('treats scalar arrays and empty containers as leaves', () => {
  const nodes = inspectRecord(curation, 'curation')
  const mood = findNode(nodes, 'categories.Mood')
  const image = findNode(nodes, 'sources.image')

  expect(mood.label).toBe('Mood')
  expect(mood.type).toBe('array')
  expect(mood.children).toEqual([])
  expect(mood.leafCount).toBe(1)
  expect(image.children).toEqual([])
  expect(image.leafCount).toBe(1)
})

test('counts null, undefined and empty-object leaves', () => {
  const nodes = inspectRecord({ unknown_note: null, missing: undefined, notes: {} }, 'curation')
  const notes = findNode(nodes, 'notes')

  expect(findNode(nodes, 'unknown_note').type).toBe('null')
  expect(findNode(nodes, 'unknown_note').leafCount).toBe(1)
  expect(findNode(nodes, 'missing').type).toBe('null')
  expect(notes.type).toBe('object')
  expect(notes.children).toEqual([])
  expect(notes.leafCount).toBe(1)
})

test('reports derived and system-managed fields', () => {
  const nodes = inspectRecord(curation, 'curation')
  const city = findNode(nodes, 'city')
  const version = findNode(nodes, 'version')

  expect(city.derivedIn).toBe('entity')
  expect(city.editable).toBe(false)
  expect(city.system).toBe(false)
  expect(version.system).toBe(true)
  expect(version.editable).toBe(false)
})

test('infers types for unregistered fields and keeps them editable', () => {
  const nodes = inspectRecord(curation, 'curation')
  const legacy = findNode(nodes, 'legacy_flag')

  expect(legacy.label).toBe('Legacy flag')
  expect(legacy.owner).toBe('curation')
  expect(legacy.type).toBe('boolean')
  expect(legacy.editable).toBe(true)
  expect(legacy.system).toBe(false)
})

test('flattens depth-first with ancestors before children', () => {
  const flat = flattenFields(inspectRecord(curation, 'curation'))
  const paths = flat.map((node) => node.path)

  expect(paths.indexOf('notes')).toBeLessThan(paths.indexOf('notes.public'))
  expect(paths).toContain('sources.audio.0.duration')
  expect(paths).toContain('curator.email')
})

test('inspects entity records and marks sync as system-managed', () => {
  const nodes = inspectRecord(entity, 'entity')

  expect(nodes.map((node) => node.path).slice(0, 9)).toEqual([
    '_id',
    'entity_id',
    'name',
    'type',
    'status',
    'externalId',
    'metadata',
    'sync',
    'data',
  ])
  expect(findNode(nodes, 'sync')).toMatchObject({ system: true, editable: false })
  expect(findNode(nodes, 'data.location.city')).toMatchObject({ label: 'City', type: 'text', editable: true })
  expect(findNode(nodes, 'data.contacts.phone').label).toBe('Phone')
})

test('treats unknown container fields as editable roots', () => {
  const nodes = inspectRecord(entity, 'entity')
  const legacyLocation = findNode(nodes, 'location')

  expect(legacyLocation.label).toBe('Location')
  expect(legacyLocation.owner).toBe('entity')
  expect(legacyLocation.type).toBe('object')
  expect(legacyLocation.editable).toBe(true)
  expect(legacyLocation.children.map((child) => child.path)).toEqual(['location.city'])
})

test('filters by field name or label, keeping ancestors', () => {
  const nodes = inspectRecord(curation, 'curation')
  const byPath = filterFields(nodes, 'private')
  const byLabel = filterFields(nodes, 'PUBLIC RECOMMENDATION')

  expect(byPath.map((node) => node.path)).toEqual(['notes'])
  expect(byPath[0].children.map((node) => node.path)).toEqual(['notes.private'])
  expect(byPath[0].leafCount).toBe(1)
  expect(byLabel.map((node) => node.path)).toEqual(['notes'])
  expect(byLabel[0].children.map((node) => node.path)).toEqual(['notes.public'])
})

test('filters by stringified leaf value, case-insensitively', () => {
  const nodes = inspectRecord(curation, 'curation')

  expect(filterFields(nodes, 'pujol').map((node) => node.path)).toEqual(['restaurant_name'])
  expect(filterFields(nodes, 'cidade').map((node) => node.path)).toEqual(['city'])
  expect(flattenFields(filterFields(nodes, '91.5')).map((node) => node.path)).toEqual([
    'sources',
    'sources.audio',
    'sources.audio.0',
    'sources.audio.0.duration',
  ])
})

test('prunes non-matching siblings while preserving order', () => {
  const filtered = filterFields(inspectRecord(curation, 'curation'), 'duration')

  expect(filtered.map((node) => node.path)).toEqual(['sources'])
  expect(flattenFields(filtered).map((node) => node.path)).toEqual([
    'sources',
    'sources.audio',
    'sources.audio.0',
    'sources.audio.0.duration',
  ])
  expect(filtered[0].leafCount).toBe(1)
})

test('keeps ancestors when the match is inside an unregistered nested object', () => {
  const record = { _id: '1', title: 'Victoria Island', location: { city: 'Saanich', postal_code: 'V8V' } }
  const filtered = filterFields(inspectRecord(record, 'curation'), 'Saanich')

  expect(flattenFields(filtered).map((node) => node.path)).toEqual(['location', 'location.city'])
  expect(filtered[0].leafCount).toBe(1)
  expect(filtered[0].editable).toBe(true)
})

test('returns the tree unchanged for an empty query and nothing for no match', () => {
  const nodes = inspectRecord(curation, 'curation')

  expect(filterFields(nodes, '')).toEqual(nodes)
  expect(filterFields(nodes, '   ')).toEqual(nodes)
  expect(filterFields(nodes, 'zzzz')).toEqual([])
})
