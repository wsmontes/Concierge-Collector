import { describe, expect, test } from 'vitest'
import type { FieldDescriptor, FieldNode, FieldType } from '../../../src/content/field-types'
import { CURATION_FIELDS } from '../../../src/content/field-registry'
import {
  buildFieldTree,
  declaredButAbsent,
  filterFieldTree,
  flattenFieldTree,
} from '../../../src/content/record-inspector'

/** Path-indexed view of a tree; every test asks "what node does this path get". */
function treeIndex(nodes: readonly FieldNode[]): Record<string, FieldNode | undefined> {
  const index: Record<string, FieldNode | undefined> = {}
  for (const node of flattenFieldTree(nodes)) index[node.path] = node
  return index
}

function pathsOf(nodes: readonly FieldNode[]): string[] {
  const paths: string[] = []
  for (const node of flattenFieldTree(nodes)) paths.push(node.path)
  return paths
}

const record = {
  curation_id: 'cur_1',
  restaurant_name: 'Cantina do Porto',
  status: 'linked',
  curator: { name: 'Ana Reis', email: 'ana@example.com' },
  curator_type: 'human',
  notes: { public: 'Great for business lunch', private: 'Ask for the corner table' },
  city: 'Lisbon',
  categories: { Mood: ['Casual', 'Lively'] },
  transcript: 'The concierge recommends the octopus.',
  sources: { audio: [{ filename: 'review-1.m4a', duration: 222 }] },
  items: [],
  version: 3,
}

describe('buildFieldTree', () => {
  test('walks the stored record in stored order, one node per field', () => {
    const tree = buildFieldTree(record, CURATION_FIELDS, 'curation')
    const expected: ReadonlyArray<readonly [string, string, FieldType, number]> = [
      ['curation_id', 'Curation id', 'text', 0],
      ['restaurant_name', 'Restaurant name', 'text', 0],
      ['status', 'Status', 'enum', 0],
      ['curator', 'Curator', 'object', 0],
      ['curator.name', 'Curator', 'text', 1],
      ['curator.email', 'Curator email', 'text', 1],
      ['curator_type', 'Curator type', 'enum', 0],
      ['notes', 'Notes', 'object', 0],
      ['notes.public', 'Public recommendation', 'longText', 1],
      ['notes.private', 'Private note', 'longText', 1],
      ['city', 'City', 'text', 0],
      ['categories', 'Concepts', 'concept', 0],
      ['categories.Mood', 'Mood', 'array', 1],
      ['categories.Mood[0]', 'Item 1', 'text', 2],
      ['categories.Mood[1]', 'Item 2', 'text', 2],
      ['transcript', 'Transcript', 'longText', 0],
      ['sources', 'Sources', 'object', 0],
      ['sources.audio', 'Audio', 'array', 1],
      ['sources.audio[0]', 'Item 1', 'object', 2],
      ['sources.audio[0].filename', 'Filename', 'text', 3],
      ['sources.audio[0].duration', 'Duration', 'number', 3],
      ['items', 'Items', 'array', 0],
      ['version', 'Version', 'number', 0],
    ]

    const actual = flattenFieldTree(tree).map((node) => [node.path, node.label, node.type, node.depth])
    expect(actual).toEqual(expected)
  })

  test('keeps each stored value on the node that addresses it', () => {
    const tree = buildFieldTree(record, CURATION_FIELDS, 'curation')
    const valued = flattenFieldTree(tree)
      .filter((node) => node.children.length === 0)
      .map((node) => [node.path, node.value])

    expect(valued).toEqual([
      ['curation_id', 'cur_1'],
      ['restaurant_name', 'Cantina do Porto'],
      ['status', 'linked'],
      ['curator.name', 'Ana Reis'],
      ['curator.email', 'ana@example.com'],
      ['curator_type', 'human'],
      ['notes.public', 'Great for business lunch'],
      ['notes.private', 'Ask for the corner table'],
      ['city', 'Lisbon'],
      ['categories.Mood[0]', 'Casual'],
      ['categories.Mood[1]', 'Lively'],
      ['transcript', 'The concierge recommends the octopus.'],
      ['sources.audio[0].filename', 'review-1.m4a'],
      ['sources.audio[0].duration', 222],
      ['items', []],
      ['version', 3],
    ])

    const index = treeIndex(tree)
    expect(index['sources']?.value).toBe(record.sources)
    expect(index['items']?.value).toBe(record.items)
  })

  test('reports owner, system and editability from the registry', () => {
    const index = treeIndex(buildFieldTree(record, CURATION_FIELDS, 'curation'))

    expect(index['curation_id']?.owner).toBe('system')
    expect(index['curation_id']?.system).toBe(true)
    expect(index['curation_id']?.editable).toBe(false)

    expect(index['city']?.owner).toBe('entity')
    expect(index['city']?.editable).toBe(false)

    expect(index['curator.email']?.system).toBe(true)
    expect(index['curator.email']?.editable).toBe(false)

    // A registered path with an explicit `editable: false` stays read-only even
    // though its type has an editor.
    expect(index['curator.name']?.editable).toBe(false)

    const registeredSystem = treeIndex(
      buildFieldTree({ version: 3, createdAt: '2026-01-01T00:00:00.000Z' }, CURATION_FIELDS, 'curation'),
    )
    expect(registeredSystem['version']?.system).toBe(true)
    expect(registeredSystem['version']?.editable).toBe(false)
    expect(registeredSystem['createdAt']?.system).toBe(true)
    expect(registeredSystem['createdAt']?.editable).toBe(false)

    expect(index['notes.public']?.editable).toBe(true)
    expect(index['notes.public']?.owner).toBe('curation')
    expect(index['notes.public']?.system).toBe(false)

    // Containers are editorial too: they get the structured editor.
    expect(index['sources']?.editable).toBe(true)
    expect(index['items']?.editable).toBe(true)
    expect(index['items']?.children).toEqual([])
  })

  test('keeps fields the registry never described, at every depth', () => {
    const tree = buildFieldTree(
      {
        legacy_notes: 'do not lose me',
        metadata: [{ data: { place_id: 'ChIJabc' } }],
        sources: { audio: [{ filename: 'review-1.m4a', codec: 'aac' }] },
      },
      CURATION_FIELDS,
      'curation',
    )
    const index = treeIndex(tree)

    expect(index['legacy_notes']?.descriptor).toBeNull()
    expect(index['legacy_notes']?.label).toBe('Legacy notes')
    expect(index['legacy_notes']?.type).toBe('text')
    expect(index['legacy_notes']?.owner).toBe('curation')
    expect(index['legacy_notes']?.editable).toBe(true)

    // A container nobody described is still walked open.
    expect(pathsOf(tree).filter((path) => path.startsWith('metadata'))).toEqual([
      'metadata',
      'metadata[0]',
      'metadata[0].data',
      'metadata[0].data.place_id',
    ])
    expect(index['metadata']?.descriptor).toBeNull()
    expect(index['metadata[0].data.place_id']?.descriptor).toBeNull()
    expect(index['metadata[0].data.place_id']?.label).toBe('Place id')

    expect(index['sources.audio[0].codec']?.descriptor).toBeNull()
    expect(index['sources.audio[0].codec']?.label).toBe('Codec')
    expect(index['sources']?.descriptor).not.toBeNull()
  })

  test('offers the structured editor to every unregistered field', () => {
    const index = treeIndex(
      buildFieldTree(
        {
          legacy_city: 'Victoria',
          legacy_tags: ['quiet', 'window seat'],
          metadata: [{ data: { legacy_code: 'x' } }],
        },
        CURATION_FIELDS,
        'curation',
      ),
    )
    const unregistered: ReadonlyArray<readonly [string, FieldType]> = [
      ['legacy_city', 'text'],
      ['legacy_tags', 'array'],
      ['metadata[0].data.legacy_code', 'text'],
      ['metadata[0].data', 'object'],
    ]
    for (const [path, type] of unregistered) {
      const node = index[path]
      expect(node?.descriptor).toBeNull()
      expect(node?.type).toBe(type)
      expect(node?.editable).toBe(true)
      expect(node?.system).toBe(false)
    }

    // Inference still decides the editor, but an untyped value is still
    // editable: the generic editor is how a legacy empty field gains a value.
    const typeless = treeIndex(buildFieldTree({ legacy_null: null }, CURATION_FIELDS, 'curation'))
    expect(typeless['legacy_null']?.descriptor).toBeNull()
    expect(typeless['legacy_null']?.type).toBe('unknown')
    expect(typeless['legacy_null']?.editable).toBe(true)
  })

  test('labels array slots the registry describes with a template', () => {
    const descriptors: FieldDescriptor[] = [
      { path: 'sources.image[].analysis', label: 'Image analysis', owner: 'curation', type: 'longText', editable: true },
      { path: 'metadata[].data.place_id', label: 'Place id', owner: 'entity', type: 'text', system: true },
    ]
    const tree = buildFieldTree(
      {
        sources: { image: [{ analysis: 'facade', caption: 'door' }, { analysis: 'terrace' }] },
        metadata: [{ data: { place_id: 'ChIJabc' } }],
      },
      descriptors,
      'curation',
    )
    const index = treeIndex(tree)

    expect(index['sources.image[0].analysis']?.descriptor).toBe(descriptors[0])
    expect(index['sources.image[1].analysis']?.descriptor).toBe(descriptors[0])
    expect(index['sources.image[1].analysis']?.label).toBe('Image analysis')
    expect(index['sources.image[1].analysis']?.type).toBe('longText')
    expect(index['sources.image[1].analysis']?.editable).toBe(true)

    expect(index['metadata[0].data.place_id']?.descriptor).toBe(descriptors[1])
    expect(index['metadata[0].data.place_id']?.label).toBe('Place id')
    expect(index['metadata[0].data.place_id']?.system).toBe(true)
    expect(index['metadata[0].data.place_id']?.editable).toBe(false)

    // The template covers one path, not the whole indexed neighbourhood.
    expect(index['sources.image[0].caption']?.descriptor).toBeNull()
    expect(index['metadata[0].data']?.descriptor).toBeNull()
    expect(pathsOf(tree).some((path) => path.includes('[]'))).toBe(false)
  })

  test('prefers an exact descriptor over the template that also covers the path', () => {
    const descriptors: FieldDescriptor[] = [
      { path: 'items[].label', label: 'Item label', owner: 'curation', type: 'text', editable: true },
      { path: 'items[0].label', label: 'First item label', owner: 'curation', type: 'text', editable: true },
    ]
    const index = treeIndex(buildFieldTree({ items: [{ label: 'a' }, { label: 'b' }] }, descriptors, 'curation'))

    expect(index['items[0].label']?.descriptor).toBe(descriptors[1])
    expect(index['items[0].label']?.label).toBe('First item label')
    expect(index['items[1].label']?.descriptor).toBe(descriptors[0])
    expect(index['items[1].label']?.label).toBe('Item label')
  })

  test('returns nothing for a record that holds no fields', () => {
    expect(buildFieldTree(undefined, CURATION_FIELDS, 'curation')).toEqual([])
    expect(buildFieldTree(null, CURATION_FIELDS, 'curation')).toEqual([])
    expect(buildFieldTree('scalar', CURATION_FIELDS, 'curation')).toEqual([])
    expect(buildFieldTree({}, CURATION_FIELDS, 'curation')).toEqual([])
  })
})

describe('flattenFieldTree', () => {
  test('walks pre-order, containers included', () => {
    const tree = buildFieldTree(record, CURATION_FIELDS, 'curation')
    expect(pathsOf(tree).slice(16, 22)).toEqual([
      'sources',
      'sources.audio',
      'sources.audio[0]',
      'sources.audio[0].filename',
      'sources.audio[0].duration',
      'items',
    ])
  })
})

describe('filterFieldTree', () => {
  const sourcesRecord = {
    notes: { public: 'Terrace recommended' },
    sources: {
      audio: [
        { filename: 'review-1.m4a', duration: 222 },
        { filename: 'review-2.m4a', duration: 305 },
      ],
      image: [{ analysis: 'facade' }],
    },
    version: 1,
  }
  const tree = buildFieldTree(sourcesRecord, CURATION_FIELDS, 'curation')

  test('keeps a matched container whole, every child included', () => {
    expect(pathsOf(filterFieldTree(tree, 'review-2.m4a'))).toEqual([
      'sources',
      'sources.audio',
      'sources.audio[0]',
      'sources.audio[0].filename',
      'sources.audio[0].duration',
      'sources.audio[1]',
      'sources.audio[1].filename',
      'sources.audio[1].duration',
      'sources.image',
      'sources.image[0]',
      'sources.image[0].analysis',
    ])
  })

  test('drops the branches a match does not need', () => {
    expect(pathsOf(filterFieldTree(tree, 'notes.public'))).toEqual(['notes', 'notes.public'])
  })

  test('keeps the ancestors of a deeper match, with only the matching branch', () => {
    expect(pathsOf(filterFieldTree(tree, 'audio[1]'))).toEqual([
      'sources',
      'sources.audio',
      'sources.audio[1]',
      'sources.audio[1].filename',
      'sources.audio[1].duration',
    ])
  })

  test('drops everything when nothing matches', () => {
    expect(filterFieldTree(tree, 'nouvelle cuisine')).toEqual([])
  })

  test('returns the very same tree for a blank query', () => {
    expect(filterFieldTree(tree, '')).toBe(tree)
    expect(filterFieldTree(tree, '   ')).toBe(tree)
  })

  test('hands back a copy, so an editor cannot mutate the source tree', () => {
    const before = pathsOf(tree)
    const filtered = filterFieldTree(tree, 'audio')
    expect(filtered).not.toBe(tree)
    expect(filtered[0]).not.toBe(tree[0])

    filtered[0].children.length = 0
    expect(pathsOf(tree)).toEqual(before)
  })
})

describe('declaredButAbsent', () => {
  const duplicate = { path: 'city', label: 'City', owner: 'entity', type: 'text' } satisfies FieldDescriptor
  const descriptors: FieldDescriptor[] = [
    { path: 'notes.public', label: 'Public recommendation', owner: 'curation', type: 'longText' },
    { path: 'items', label: 'Items', owner: 'curation', type: 'array' },
    { path: 'curator.name', label: 'Curator', owner: 'curation', type: 'text' },
    { path: 'sources.image[].analysis', label: 'Image analysis', owner: 'curation', type: 'longText' },
    duplicate,
    duplicate,
  ]
  const tree = buildFieldTree({ notes: { public: 'ok' }, items: [] }, descriptors, 'curation')

  test('reports the registry entries the record does not store, in registry order', () => {
    expect(declaredButAbsent(descriptors, tree).map((descriptor) => descriptor.path)).toEqual(['curator.name', 'city'])
  })

  test('never reports a template path nor the same path twice', () => {
    const absent = declaredButAbsent(descriptors, tree)
    expect(absent).toEqual([descriptors[2], duplicate])
    expect(absent.some((descriptor) => descriptor.path.includes('[]'))).toBe(false)
  })

  test('sees through the tree, including array slots and nested keys', () => {
    const registry = [
      { path: 'sources', label: 'Sources', owner: 'curation', type: 'object' },
      { path: 'sources.audio', label: 'Audio', owner: 'curation', type: 'array' },
      { path: 'sources.video', label: 'Video', owner: 'curation', type: 'array' },
      { path: 'notes.private', label: 'Private note', owner: 'curation', type: 'longText' },
    ] satisfies FieldDescriptor[]
    const nodes = buildFieldTree({ sources: { audio: [{ filename: 'a.m4a' }] } }, registry, 'curation')

    expect(declaredButAbsent(registry, nodes).map((descriptor) => descriptor.path)).toEqual([
      'sources.video',
      'notes.private',
    ])
  })

  test('finds the curation fields a partial record omits', () => {
    const partial = buildFieldTree({ notes: { public: 'ok' }, items: [] }, CURATION_FIELDS, 'curation')
    const absent = declaredButAbsent(CURATION_FIELDS, partial).map((descriptor) => descriptor.path)

    expect(absent).toContain('notes.private')
    expect(absent).toContain('curation_id')
    expect(absent).toContain('embeddings_metadata')
    expect(absent).not.toContain('notes.public')
    expect(absent).not.toContain('items')
    expect(absent.length).toBe(CURATION_FIELDS.length - 2)
  })

  test('treats a kind it was not built for as fully absent', () => {
    const nodes = buildFieldTree({ name: 'Cantina' }, [], 'entity')
    expect(declaredButAbsent([{ path: 'name', label: 'Name', owner: 'entity', type: 'text' }], nodes)).toEqual([])
    expect(declaredButAbsent([{ path: 'status', label: 'Status', owner: 'entity', type: 'enum' }], nodes).length).toBe(1)
  })
})
