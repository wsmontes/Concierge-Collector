export type FieldType =
  | 'text'
  | 'longText'
  | 'number'
  | 'boolean'
  | 'dateTime'
  | 'enum'
  | 'relationship'
  | 'concept'
  | 'array'
  | 'object'
  | 'json'
  | 'null'

/**
 * Value-level classification only. Editorial semantics (long text, enum, date,
 * relationship, concept) are path properties and come from the field registry —
 * an ISO date string must not be guessed from its content.
 */
export function inferFieldType(value: unknown): FieldType {
  if (value === null || value === undefined) return 'null'
  // Mongo drivers hand back Date instances before JSON serialization.
  if (value instanceof Date) return 'dateTime'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'boolean':
      return 'boolean'
    case 'number':
      return 'number'
    case 'string':
      return 'text'
    case 'object':
      return 'object'
    default:
      return 'json'
  }
}
