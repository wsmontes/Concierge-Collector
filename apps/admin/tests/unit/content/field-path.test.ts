import { describe, expect, test } from 'vitest'
import {
  fieldPathLabel,
  formatFieldPath,
  getFieldValue,
  matchesFieldQuery,
  parseFieldPath,
  removeFieldValue,
  setFieldValue,
} from '../../../src/content/field-path'
import { humanizeFieldName, inferFieldType, isContainerType, isFieldEditable } from '../../../src/content/field-types'

const record = {
  curation_id: 'cur_1',
  notes: { public: 'Great for business lunch', private: 'anniversary' },
  categories: { Mood: ['Casual', 'Lively'], 'Price Range': ['$$$'] },
  sources: { audio: [{ filename: 'review-1.m4a', duration: 222 }], image: [{ analysis: null }, { analysis: 'facade' }] },
  metadata: [{ data: { place_id: 'ChIJabc' } }],
  items: [],
}

describe('field path parsing', () => {
  test('parses bracketed, numeric and dotted segments into one notation', () => {
    expect(parseFieldPath('sources.audio[0].filename')).toEqual([
      { kind: 'key', key: 'sources' },
      { kind: 'key', key: 'audio' },
      { kind: 'index', index: 0 },
      { kind: 'key', key: 'filename' },
    ])
    expect(formatFieldPath(parseFieldPath('metadata.0.data.place_id'))).toBe('metadata[0].data.place_id')
    expect(formatFieldPath(parseFieldPath('items[0][1]'))).toBe('items[0][1]')
  })
})

describe('field path reads', () => {
  test('reads nested values, array slots and implicit nulls', () => {
    expect(getFieldValue(record, 'notes.private')).toBe('anniversary')
    expect(getFieldValue(record, 'sources.audio[0].duration')).toBe(222)
    expect(getFieldValue(record, 'metadata[0].data.place_id')).toBe('ChIJabc')
    expect(getFieldValue(record, 'sources.image[1].analysis')).toBe('facade')
    expect(getFieldValue(record, 'notes.missing')).toBeUndefined()
    expect(getFieldValue(record, 'sources.video[0].filename')).toBeUndefined()
    expect(getFieldValue(record, 'notes.private.deeper')).toBeUndefined()
  })
})

describe('field path writes', () => {
  test('writes immutably and leaves the source record untouched', () => {
    const next = setFieldValue(record, 'notes.public', 'Edited note')
    expect(getFieldValue(next, 'notes.public')).toBe('Edited note')
    expect(record.notes.public).toBe('Great for business lunch')
    expect(next).not.toBe(record)
    expect(next.notes).not.toBe(record.notes)
  })

  test('creates missing containers, including arrays addressed by index', () => {
    const next = setFieldValue({}, 'sources.audio[0].filename', 'new.m4a')
    expect(next).toEqual({ sources: { audio: [{ filename: 'new.m4a' }] } })
    const throughNull = setFieldValue({ a: null }, 'a.b.c', 2)
    expect(throughNull).toEqual({ a: { b: { c: 2 } } })
  })

  test('refuses to overwrite a scalar that the path needs as a container', () => {
    expect(() => setFieldValue({ a: 1 }, 'a.b', 2)).toThrow(/not a container/)
    expect(() => setFieldValue({ a: 'text' }, 'a.b', 2)).toThrow(/not a container/)
    expect(() => setFieldValue({ a: [1] }, 'a.b', 2)).toThrow(/expected an object/)
  })

  test('writes deep object and array values without dropping siblings', () => {
    const next = setFieldValue(record, 'categories.Mood', ['Business'])
    expect(next.categories).toEqual({ Mood: ['Business'], 'Price Range': ['$$$'] })
    const appended = setFieldValue(record, 'sources.audio[1]', { filename: 'review-2.m4a' })
    expect(appended.sources.audio).toHaveLength(2)
    expect(appended.sources.audio[0]).toBe(record.sources.audio[0])
  })

  test('removes keys and array slots immutably', () => {
    const withoutNote = removeFieldValue(record, 'notes.private')
    expect(withoutNote.notes).toEqual({ public: 'Great for business lunch' })
    expect(record.notes.private).toBe('anniversary')
    const withoutAudio = removeFieldValue(record, 'sources.audio[0]')
    expect(withoutAudio.sources.audio).toEqual([])
  })
})

describe('field path search and labels', () => {
  test('matches by field name or stored value', () => {
    expect(matchesFieldQuery('categories.Mood', ['Casual'], 'mood')).toBe(true)
    expect(matchesFieldQuery('categories.Mood', ['Casual'], 'casual')).toBe(true)
    expect(matchesFieldQuery('sources.audio[0].filename', 'review-1.m4a', 'REVIEW-1')).toBe(true)
    expect(matchesFieldQuery('notes.private', 'anniversary', 'birthday')).toBe(false)
    expect(matchesFieldQuery('notes.private', 'anniversary', '   ')).toBe(true)
  })

  test('labels unknown paths without leaking raw notation', () => {
    expect(fieldPathLabel('notes.private')).toBe('Private')
    expect(fieldPathLabel('sources.audio[0]')).toBe('Item 1')
    expect(fieldPathLabel('catalog_sequence')).toBe('Catalog sequence')
    expect(humanizeFieldName('externalId')).toBe('External Id')
  })
})

describe('field type inference', () => {
  test('classifies stored values conservatively', () => {
    expect(inferFieldType('2026-09-14T10:00:00Z')).toBe('text')
    expect(inferFieldType(3)).toBe('number')
    expect(inferFieldType(false)).toBe('boolean')
    expect(inferFieldType([1, 2])).toBe('array')
    expect(inferFieldType({ a: 1 })).toBe('object')
    expect(inferFieldType(null)).toBe('unknown')
    expect(inferFieldType(undefined)).toBe('unknown')
    expect(inferFieldType(new Date(0))).toBe('dateTime')
  })

  test('routes types to editors and containers', () => {
    expect(isFieldEditable('text')).toBe(true)
    expect(isFieldEditable('json')).toBe(true)
    expect(isFieldEditable('binary')).toBe(false)
    expect(isFieldEditable('unknown')).toBe(true)
    expect(isContainerType('object')).toBe(true)
    expect(isContainerType('text')).toBe(false)
  })
})
