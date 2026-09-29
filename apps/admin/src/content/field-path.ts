/**
 * Dotted paths are the single addressing scheme shared by the field registry,
 * the record walk and the UI; join/split live here so they cannot drift apart.
 */
export function joinPath(parent: string, key: string): string {
  if (parent === '') return key
  if (key === '') return parent
  return `${parent}.${key}`
}

export function pathSegments(path: string): string[] {
  return path.split('.').filter((segment) => segment.length > 0)
}

const INDEX_SEGMENT = /^\d+$/

export function readPath(record: unknown, path: string): unknown {
  if (path === '') return record
  let current: unknown = record
  for (const segment of pathSegments(path)) {
    if (current === null || typeof current !== 'object') return undefined
    // Arrays only answer numeric segments: `length` or methods must never be
    // reported as record fields.
    if (Array.isArray(current) && !INDEX_SEGMENT.test(segment)) return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
