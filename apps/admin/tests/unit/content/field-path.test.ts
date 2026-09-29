import { expect, test } from 'vitest'
import { joinPath, pathSegments, readPath } from '../../../src/content/field-path'

test('joins dotted segments without a leading separator', () => {
  expect(joinPath('a', '0')).toBe('a.0')
  expect(joinPath('', 'a')).toBe('a')
  expect(joinPath('sources.audio', '0')).toBe('sources.audio.0')
  expect(joinPath('a', '')).toBe('a')
})

test('splits paths into non-empty segments', () => {
  expect(pathSegments('sources.audio.0.duration')).toEqual(['sources', 'audio', '0', 'duration'])
  expect(pathSegments('')).toEqual([])
})

test('reads a value through array indexes', () => {
  const record = { sources: { audio: [{ filename: 'a.m4a', duration: 91.5 }] } }

  expect(readPath(record, 'sources.audio.0.duration')).toBe(91.5)
  expect(readPath(record, 'sources.audio.0.filename')).toBe('a.m4a')
  expect(readPath(record, '')).toBe(record)
})

test('returns undefined instead of throwing for unresolved paths', () => {
  const record = { sources: { audio: [{ duration: 91.5 }] } }

  expect(readPath(record, 'sources.audio.1.duration')).toBeUndefined()
  expect(readPath(record, 'sources.missing.duration')).toBeUndefined()
  expect(readPath(record, 'sources.audio.0.missing')).toBeUndefined()
  expect(readPath(record, 'sources.audio.0.duration.deeper')).toBeUndefined()
  expect(readPath(record, 'nope.path')).toBeUndefined()
  expect(readPath(null, 'a')).toBeUndefined()
  expect(readPath(undefined, 'a.b')).toBeUndefined()
  expect(readPath(42, 'a')).toBeUndefined()
})

test('never resolves array internals as fields', () => {
  const record = { sources: { audio: [{ duration: 91.5 }] } }

  expect(readPath(record, 'sources.audio.length')).toBeUndefined()
})
