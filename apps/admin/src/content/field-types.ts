/**
 * Frozen vocabulary of the editorial content layer.
 *
 * The Admin must render 100% of a stored record, including fields that no
 * screen was written for. Everything the registry, the inspector and the
 * editors agree on lives here so those three pieces never drift.
 */

/** Record families the editorial Admin knows how to describe. */
export type ContentRecordKind = 'curation' | 'entity' | 'collection'

/** Where a field is owned — see the plan's field classification table. */
export type FieldOwner = ContentRecordKind | 'system'

/**
 * Editor category. `json` and `unknown` are the escape hatches: a value the
 * registry never described still gets an editor.
 */
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
  | 'binary'
  | 'unknown'

export interface RelationshipDescriptor {
  kind: ContentRecordKind
  /**
   * `identifier` writes an id into the owner record, `membership` calls a
   * dedicated operation instead, `readonly` is navigation only.
   */
  edit: 'identifier' | 'membership' | 'readonly'
}

/**
 * Metadata for one known field. The registry describes fields; it never
 * decides which fields exist — anything absent from the registry is still
 * rendered from the record itself.
 */
export interface FieldDescriptor {
  path: string
  label: string
  owner: FieldOwner
  type: FieldType
  /** Editorial grouping used by the full record page. */
  section?: string
  editable?: boolean
  searchable?: boolean
  filterable?: boolean
  listable?: boolean
  /** System-managed: visible, never editable. */
  system?: boolean
  /** This field is a projection of another record's field. */
  derivedIn?: ContentRecordKind
  /** Label of the record the value is derived from. */
  derivedFrom?: string
  enumValues?: readonly string[]
  relationship?: RelationshipDescriptor
  help?: string
}

/** One node of a record's field tree. Container nodes carry children. */
export interface FieldNode {
  path: string
  label: string
  type: FieldType
  value: unknown
  depth: number
  /** Registry entry when the path is known. */
  descriptor: FieldDescriptor | null
  owner: FieldOwner
  editable: boolean
  system: boolean
  children: FieldNode[]
}

/** Types whose values an editor can write. */
const EDITABLE_TYPE: Record<FieldType, true | undefined> = {
  text: true,
  longText: true,
  number: true,
  boolean: true,
  dateTime: true,
  enum: true,
  relationship: true,
  concept: true,
  array: true,
  object: true,
  json: true,
  binary: undefined,
  // A value with no inferred type still gets the generic editor (plan §31:
  // `null` → generic editor), which is how a legacy empty field gains a value.
  unknown: true,
}

/** Types that hold other fields. */
const CONTAINER_TYPE: Record<FieldType, true | undefined> = {
  text: undefined,
  longText: undefined,
  number: undefined,
  boolean: undefined,
  dateTime: undefined,
  enum: undefined,
  relationship: undefined,
  concept: undefined,
  array: true,
  object: true,
  json: true,
  binary: undefined,
  unknown: undefined,
}

/**
 * Types a value by its runtime shape. Deliberately conservative: an ISO date
 * string stays `text` because only the registry knows a field's meaning.
 */
export function inferFieldType(value: unknown): FieldType {
  if (value === null || value === undefined) return 'unknown'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'dateTime'
  if (value instanceof Uint8Array) return 'binary'
  switch (typeof value) {
    case 'string':
      return 'text'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'object'
    default:
      return 'unknown'
  }
}

/** Whether a field of this type has an editor that can write a new value. */
export function isFieldEditable(type: FieldType): boolean {
  return EDITABLE_TYPE[type] === true
}

/** Whether a field of this type holds other fields. */
export function isContainerType(type: FieldType): boolean {
  return CONTAINER_TYPE[type] === true
}

/**
 * Types the generic structured editor owns: containers plus values with no
 * inferred shape. One definition, so a surface that lists "flexible fields"
 * cannot drift from the editor that renders them.
 */
const STRUCTURED_TYPE: Record<FieldType, true | undefined> = {
  text: undefined,
  longText: undefined,
  number: undefined,
  boolean: undefined,
  dateTime: undefined,
  enum: undefined,
  relationship: undefined,
  concept: undefined,
  array: true,
  object: true,
  json: true,
  binary: undefined,
  unknown: true,
}

export function isStructuredType(type: FieldType): boolean {
  return STRUCTURED_TYPE[type] === true
}

/** Human label for a path the registry does not describe. */
export function humanizeFieldName(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  if (spaced.length === 0) return name
  return spaced.charAt(0).toLocaleUpperCase() + spaced.slice(1)
}
