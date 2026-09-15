import { describe, expect, test } from 'vitest'
import type { ContentRecordKind, FieldDescriptor } from '../../../src/content/field-types'
import {
  COLLECTION_FIELDS,
  CURATION_FIELDS,
  ENTITY_FIELDS,
  descriptorsFor,
} from '../../../src/content/field-registry'

const KINDS: readonly ContentRecordKind[] = ['curation', 'entity', 'collection']

function offenders(descriptors: readonly FieldDescriptor[], predicate: (descriptor: FieldDescriptor) => boolean): string[] {
  const paths: string[] = []
  for (const descriptor of descriptors) {
    if (predicate(descriptor)) paths.push(descriptor.path)
  }
  return paths
}

describe('descriptorsFor', () => {
  test('resolves each record family to its own registry', () => {
    expect(descriptorsFor('curation')).toBe(CURATION_FIELDS)
    expect(descriptorsFor('entity')).toBe(ENTITY_FIELDS)
    expect(descriptorsFor('collection')).toBe(COLLECTION_FIELDS)
    expect(CURATION_FIELDS.length).toBeGreaterThan(0)
    expect(ENTITY_FIELDS.length).toBeGreaterThan(0)
    expect(COLLECTION_FIELDS.length).toBeGreaterThan(0)
  })

  test('addresses every path at most once inside a family', () => {
    const duplicated: string[] = []
    for (const kind of KINDS) {
      const counted: Record<string, number | undefined> = {}
      for (const descriptor of descriptorsFor(kind)) {
        counted[descriptor.path] = (counted[descriptor.path] ?? 0) + 1
      }
      for (const path of Object.keys(counted)) {
        if (counted[path] !== 1) duplicated.push(`${kind}:${path}`)
      }
    }
    expect(duplicated).toEqual([])
  })

  test('labels every entry', () => {
    for (const kind of KINDS) {
      const descriptors = descriptorsFor(kind)
      expect(offenders(descriptors, (descriptor) => descriptor.path.length === 0)).toEqual([])
      expect(offenders(descriptors, (descriptor) => descriptor.label.length === 0)).toEqual([])
    }
  })

  test('groups curation and entity fields into sections', () => {
    for (const descriptors of [CURATION_FIELDS, ENTITY_FIELDS]) {
      expect(offenders(descriptors, (descriptor) => descriptor.section === undefined)).toEqual([])
    }
  })
})

describe('registry invariants', () => {
  test('system-managed fields are never offered for editing', () => {
    const editable: string[] = []
    for (const kind of KINDS) {
      for (const path of offenders(descriptorsFor(kind), (descriptor) => descriptor.system === true && descriptor.editable === true)) {
        editable.push(`${kind}:${path}`)
      }
    }
    expect(editable).toEqual([])
  })

  test('enum fields carry their vocabulary', () => {
    for (const kind of KINDS) {
      const descriptors = descriptorsFor(kind)
      const enums = descriptors.filter((descriptor) => descriptor.type === 'enum')
      expect(enums.length).toBeGreaterThan(0)
      for (const descriptor of enums) {
        const values = descriptor.enumValues ?? []
        expect(values.length).toBeGreaterThan(1)
        expect(values.filter((value, position) => values.indexOf(value) === position)).toEqual(values)
      }
      expect(offenders(descriptors, (descriptor) => descriptor.type !== 'enum' && descriptor.enumValues !== undefined)).toEqual([])
    }
  })

  test('relationship fields describe their target', () => {
    const relationships = CURATION_FIELDS.filter((descriptor) => descriptor.type === 'relationship')
    expect(relationships.map((descriptor) => descriptor.path)).toEqual(['entity_id'])
    expect(relationships[0].relationship).toEqual({ kind: 'entity', edit: 'identifier' })
  })

  test('editable entries declare an owner that is not the system', () => {
    for (const kind of KINDS) {
      expect(
        offenders(descriptorsFor(kind), (descriptor) => descriptor.editable === true && descriptor.owner === 'system'),
      ).toEqual([])
    }
  })
})

describe('curation registry', () => {
  test('describes identity, curation content and the system tail', () => {
    const index: Record<string, FieldDescriptor | undefined> = {}
    for (const descriptor of CURATION_FIELDS) index[descriptor.path] = descriptor

    expect(index['curation_id']).toMatchObject({ owner: 'system', type: 'text', system: true, section: 'Identity' })
    expect(index['notes.public']).toMatchObject({
      label: 'Public recommendation',
      type: 'longText',
      editable: true,
      searchable: true,
      section: 'Your curation',
    })
    expect(index['status']?.enumValues).toEqual(['draft', 'linked', 'active', 'deleted', 'archived'])
    expect(index['embeddings']).toMatchObject({ owner: 'system', type: 'binary', system: true, section: 'Advanced' })
    expect(index['embeddings']?.help?.length).toBeGreaterThan(0)
    expect(index['curator_id']?.help?.length).toBeGreaterThan(0)
  })

  test('marks the projected fields as the entity record fields', () => {
    const index: Record<string, FieldDescriptor | undefined> = {}
    for (const descriptor of CURATION_FIELDS) index[descriptor.path] = descriptor

    expect(index['city']).toMatchObject({
      owner: 'entity',
      type: 'text',
      editable: false,
      derivedIn: 'curation',
      derivedFrom: 'Entity',
    })
    expect(index['type']).toMatchObject({ owner: 'entity', editable: false, derivedIn: 'curation' })
    expect(index['curator.name']).toMatchObject({ editable: false, derivedIn: 'curation', derivedFrom: 'Curator' })
    expect(index['curator.email']).toMatchObject({ system: true, editable: false })
    expect(index['categories']).toMatchObject({ label: 'Concepts', type: 'concept', editable: true })
    expect(index['sources']).toMatchObject({ type: 'object', editable: true, section: 'Media & sources' })
    expect(index['items']).toMatchObject({ type: 'array', editable: true })
  })
})

describe('entity registry', () => {
  test('covers canonical identity and the flexible attribute bags', () => {
    const index: Record<string, FieldDescriptor | undefined> = {}
    for (const descriptor of ENTITY_FIELDS) index[descriptor.path] = descriptor

    expect(index['entity_id']).toMatchObject({ owner: 'system', system: true, section: 'Identity' })
    expect(index['name']).toMatchObject({ type: 'text', editable: true, searchable: true, listable: true })
    expect(index['type']?.enumValues).toEqual(['restaurant', 'hotel', 'venue', 'bar', 'cafe', 'other'])
    expect(index['status']?.enumValues).toEqual(['active', 'inactive', 'draft'])
    expect(index['externalId']).toMatchObject({ type: 'text', editable: true, searchable: true })
    expect(index['metadata']).toMatchObject({ type: 'array', editable: true, section: 'Metadata' })
    expect(index['sync']).toMatchObject({ type: 'object', editable: true, section: 'Metadata' })
    expect(index['data']).toMatchObject({ label: 'Attributes', type: 'object', editable: true, searchable: true })
  })
})

describe('collection registry', () => {
  test('keeps publishing state out of editorial hands', () => {
    const index: Record<string, FieldDescriptor | undefined> = {}
    for (const descriptor of COLLECTION_FIELDS) index[descriptor.path] = descriptor

    expect(index['title']).toMatchObject({ type: 'text', editable: true, listable: true })
    expect(index['slug']).toMatchObject({ type: 'text', editable: true, searchable: true })
    expect(index['description']).toMatchObject({ type: 'longText', editable: true })
    expect(index['lifecycle']).toMatchObject({ type: 'enum', editable: false, listable: true })
    expect(index['lifecycle']?.enumValues).toEqual(['draft', 'published', 'archived'])
    expect(index['draftState']).toMatchObject({ type: 'enum', editable: false })
    expect(index['draftState']?.enumValues).toEqual(['clean', 'dirty'])
    expect(index['currentPublishedVersion']).toMatchObject({ type: 'number', system: true })
    expect(index['draftSelectedCount']).toMatchObject({ type: 'number', system: true })
    expect(index['revision']).toMatchObject({ type: 'number', system: true })
    expect(index['updatedAt']).toMatchObject({ type: 'dateTime', system: true })
  })
})
