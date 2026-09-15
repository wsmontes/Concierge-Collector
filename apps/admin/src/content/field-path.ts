/**
 * Addressing for arbitrary stored fields.
 *
 * Paths are the notation the Field Inspector shows and the structured editor
 * writes: `sources.audio[0].filename`, `metadata[0].data.place_id`,
 * `categories.Mood`. Reads are tolerant, writes are immutable.
 */

import { humanizeFieldName, inferFieldType } from './field-types'
import { isRecord } from './value-guards'

export type PathSegment = { kind: 'key'; key: string } | { kind: 'index'; index: number }

const INDEX_SEGMENT = /^\[(\d+)\]$/
const TRAILING_INDEXES = /^([^[\]]*)((?:\[\d+\])+)$/
const DIGITS = /^\d+$/

/**
 * Parses a dotted path. Both `items[0]` and `items.0` address index 0 —
 * a purely numeric segment is always an array index.
 */
export function parseFieldPath(path: string): PathSegment[] {
  const segments: PathSegment[] = []
  for (const raw of path.split('.')) {
    if (raw.length === 0) continue
    const bracket = INDEX_SEGMENT.exec(raw)
    if (bracket) {
      segments.push({ kind: 'index', index: Number(bracket[1]) })
      continue
    }
    const expanded = TRAILING_INDEXES.exec(raw)
    if (expanded) {
      if (expanded[1].length > 0) segments.push({ kind: 'key', key: expanded[1] })
      for (const index of expanded[2].matchAll(/\[(\d+)\]/g)) {
        segments.push({ kind: 'index', index: Number(index[1]) })
      }
      continue
    }
    if (DIGITS.test(raw)) {
      segments.push({ kind: 'index', index: Number(raw) })
      continue
    }
    segments.push({ kind: 'key', key: raw })
  }
  return segments
}

/** Renders segments back into canonical path notation. */
export function formatFieldPath(segments: readonly PathSegment[]): string {
  let path = ''
  for (const segment of segments) {
    if (segment.kind === 'index') {
      path += `[${segment.index}]`
      continue
    }
    path += path.length === 0 ? segment.key : `.${segment.key}`
  }
  return path
}

/** Reads a value, tolerating missing containers anywhere along the path. */
export function getFieldValue(record: unknown, path: string): unknown {
  let current: unknown = record
  for (const segment of parseFieldPath(path)) {
    if (current === null || current === undefined) return undefined
    if (segment.kind === 'index') {
      if (!Array.isArray(current)) return undefined
      current = current[segment.index]
      continue
    }
    if (!isRecord(current)) return undefined
    current = current[segment.key]
  }
  return current
}

function childOf(parent: unknown, segment: PathSegment): unknown {
  if (segment.kind === 'index') return Array.isArray(parent) ? parent[segment.index] : undefined
  return isRecord(parent) ? parent[segment.key] : undefined
}

function assignChild(parent: unknown, segment: PathSegment, child: unknown, path: string): void {
  if (segment.kind === 'index') {
    if (!Array.isArray(parent)) throw new Error(`Cannot write ${path}: expected an array at [${segment.index}]`)
    parent[segment.index] = child
    return
  }
  if (!isRecord(parent)) throw new Error(`Cannot write ${path}: expected an object at ${segment.key}`)
  parent[segment.key] = child
}

function emptyContainerFor(segment: PathSegment | undefined): unknown {
  return segment?.kind === 'index' ? [] : {}
}

/**
 * Returns a writable copy of an existing container. A missing container is
 * created to match the next segment; a scalar in the way is an error, because
 * overwriting real data to satisfy a malformed path is never what the editor
 * meant.
 */
function prepareChild(existing: unknown, next: PathSegment | undefined, path: string): unknown {
  if (Array.isArray(existing)) return existing.slice()
  if (isRecord(existing)) return { ...existing }
  if (existing === undefined || existing === null) return emptyContainerFor(next)
  throw new Error(`Cannot write ${path}: the existing value at this path is not a container`)
}

/**
 * Writes a value immutably: every container along the path is copied.
 *
 * @throws when a scalar blocks an intermediate segment of the path.
 */
export function setFieldValue<T>(record: T, path: string, value: unknown): T {
  const segments = parseFieldPath(path)
  if (segments.length === 0) return value as T
  const root = prepareChild(record, segments[0], path)
  let parent: unknown = root
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    const child = prepareChild(childOf(parent, segment), segments[index + 1], path)
    assignChild(parent, segment, child, path)
    parent = child
  }
  assignChild(parent, segments[segments.length - 1], value, path)
  return root as T
}

/** Removes a key or array slot immutably. */
export function removeFieldValue<T>(record: T, path: string): T {
  const segments = parseFieldPath(path)
  if (segments.length === 0) return record
  const parentSegments = segments.slice(0, -1)
  if (parentSegments.length === 0) return removeAt(record, segments[0]) as T
  const parentPath = formatFieldPath(parentSegments)
  const container = getFieldValue(record, parentPath)
  if (container === undefined) return record
  return setFieldValue(record, parentPath, removeAt(container, segments[segments.length - 1]))
}

function removeAt(container: unknown, segment: PathSegment): unknown {
  if (segment.kind === 'index') {
    if (!Array.isArray(container)) return container
    const next = container.slice()
    next.splice(segment.index, 1)
    return next
  }
  if (!isRecord(container)) return container
  const next = { ...container }
  delete next[segment.key]
  return next
}

/** Human label for the leaf of a path, used when the registry is silent. */
export function fieldPathLabel(path: string): string {
  const segments = parseFieldPath(path)
  const leaf = segments[segments.length - 1]
  if (leaf === undefined) return path
  return leaf.kind === 'key' ? humanizeFieldName(leaf.key) : `Item ${leaf.index + 1}`
}

function stringifyForSearch(value: unknown): string {
  if (value === null || value === undefined) return ''
  switch (inferFieldType(value)) {
    case 'object':
    case 'array':
      try {
        return JSON.stringify(value) ?? ''
      } catch {
        return ''
      }
    case 'boolean':
      return value ? 'true false' : 'false'
    default:
      return String(value)
  }
}

/**
 * Record-local search: the Field Inspector's "search this record" matches the
 * field name *or* the stored value, so an editor who knows only the value can
 * still find the field holding it.
 */
export function matchesFieldQuery(path: string, value: unknown, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (needle.length === 0) return true
  if (path.toLocaleLowerCase().includes(needle)) return true
  return stringifyForSearch(value).toLocaleLowerCase().includes(needle)
}
