import { pathSegments } from './field-path'
import type { FieldType } from './field-types'

export type FieldOwner = 'curation' | 'entity' | 'collection' | 'system'

export interface FieldDescriptor {
  path: string
  label: string
  owner: FieldOwner
  type: FieldType
  section: string
  searchable?: boolean
  filterable?: boolean
  editable?: boolean
  listable?: boolean
  system?: boolean
  derivedIn?: FieldOwner
}

type FieldSection =
  | 'about'
  | 'identity'
  | 'curation'
  | 'concepts'
  | 'media'
  | 'relationships'
  | 'history'
  | 'system'
  | 'other'

type ContentKind = 'curation' | 'entity'

/** Entries omit `owner`: ownership is a property of the document, not of the field. */
interface FieldInit {
  path: string
  label: string
  type: FieldType
  section: FieldSection
  searchable?: boolean
  filterable?: boolean
  editable?: boolean
  listable?: boolean
  system?: boolean
  derivedIn?: FieldOwner
}

function ownedBy(owner: FieldOwner, fields: readonly FieldInit[]): readonly FieldDescriptor[] {
  return fields.map((field) => ({ owner, ...field }))
}

/**
 * Curation records (see concierge-api-v3 app/models/schemas.py Curation).
 * `city`/`type` are denormalized from the linked Entity and are therefore
 * read-only projections: the Entity is the canonical owner.
 */
export const CURATION_FIELDS: readonly FieldDescriptor[] = ownedBy('curation', [
  { path: '_id', label: 'Mongo ID', type: 'text', section: 'system', searchable: true, system: true, editable: false },
  {
    path: 'curation_id',
    label: 'Curation ID',
    type: 'text',
    section: 'identity',
    searchable: true,
    filterable: true,
    listable: true,
    editable: false,
  },
  {
    path: 'restaurant_name',
    label: 'Restaurant name',
    type: 'text',
    section: 'about',
    searchable: true,
    filterable: true,
    listable: true,
    editable: true,
  },
  {
    path: 'status',
    label: 'Curation status',
    type: 'enum',
    section: 'curation',
    searchable: true,
    filterable: true,
    listable: true,
    editable: true,
  },
  {
    path: 'city',
    label: 'City',
    type: 'text',
    section: 'about',
    searchable: true,
    filterable: true,
    listable: true,
    editable: false,
    derivedIn: 'entity',
  },
  {
    path: 'type',
    label: 'Entity type',
    type: 'enum',
    section: 'about',
    filterable: true,
    listable: true,
    editable: false,
    derivedIn: 'entity',
  },
  { path: 'notes', label: 'Notes', type: 'object', section: 'curation', searchable: true, editable: true },
  {
    path: 'notes.public',
    label: 'Public recommendation',
    type: 'longText',
    section: 'curation',
    searchable: true,
    filterable: true,
    editable: true,
  },
  { path: 'notes.private', label: 'Private note', type: 'longText', section: 'curation', searchable: true, editable: true },
  {
    path: 'categories',
    label: 'Concepts',
    type: 'object',
    section: 'concepts',
    searchable: true,
    filterable: true,
    editable: true,
  },
  { path: 'transcript', label: 'Transcript', type: 'longText', section: 'media', searchable: true, editable: true },
  { path: 'sources', label: 'Sources', type: 'object', section: 'media', searchable: true, editable: true },
  { path: 'items', label: 'Items', type: 'array', section: 'concepts', searchable: true, editable: true },
  {
    path: 'entity_id',
    label: 'Linked entity',
    type: 'relationship',
    section: 'relationships',
    filterable: true,
    editable: true,
  },
  {
    path: 'curator',
    label: 'Curator',
    type: 'relationship',
    section: 'relationships',
    searchable: true,
    filterable: true,
    editable: false,
  },
  {
    path: 'curator.id',
    label: 'Curator ID',
    type: 'text',
    section: 'relationships',
    filterable: true,
    editable: false,
  },
  { path: 'curator.name', label: 'Curator name', type: 'text', section: 'relationships', searchable: true, editable: false },
  {
    path: 'curator.email',
    label: 'Curator email',
    type: 'text',
    section: 'relationships',
    searchable: true,
    editable: false,
  },
  {
    path: 'curator_id',
    label: 'Curator reference',
    type: 'relationship',
    section: 'relationships',
    filterable: true,
    editable: false,
  },
  {
    path: 'curator_type',
    label: 'Curator type',
    type: 'enum',
    section: 'curation',
    filterable: true,
    editable: false,
  },
  {
    path: 'createdAt',
    label: 'Created at',
    type: 'dateTime',
    section: 'history',
    filterable: true,
    system: true,
    editable: false,
  },
  {
    path: 'updatedAt',
    label: 'Updated at',
    type: 'dateTime',
    section: 'history',
    filterable: true,
    system: true,
    editable: false,
  },
  { path: 'createdBy', label: 'Created by', type: 'text', section: 'history', searchable: true, system: true, editable: false },
  { path: 'updatedBy', label: 'Updated by', type: 'text', section: 'history', searchable: true, system: true, editable: false },
  { path: 'version', label: 'Version', type: 'number', section: 'system', system: true, editable: false },
  {
    path: 'catalog_sequence',
    label: 'Catalog sequence',
    type: 'number',
    section: 'system',
    filterable: true,
    listable: true,
    system: true,
    editable: false,
  },
  { path: 'embeddings', label: 'Embeddings', type: 'array', section: 'system', system: true, editable: false },
  {
    path: 'embeddings_metadata',
    label: 'Embeddings metadata',
    type: 'object',
    section: 'system',
    system: true,
    editable: false,
  },
])

/**
 * Entity records (see concierge-api-v3 app/models/schemas.py Entity). `data` is
 * the flexible payload; the registered sub-paths are the ones the pipeline and
 * the consumer distribution actually read.
 */
export const ENTITY_FIELDS: readonly FieldDescriptor[] = ownedBy('entity', [
  { path: '_id', label: 'Mongo ID', type: 'text', section: 'system', searchable: true, system: true, editable: false },
  {
    path: 'entity_id',
    label: 'Entity ID',
    type: 'text',
    section: 'identity',
    searchable: true,
    filterable: true,
    listable: true,
    editable: false,
  },
  {
    path: 'name',
    label: 'Name',
    type: 'text',
    section: 'about',
    searchable: true,
    filterable: true,
    listable: true,
    editable: true,
  },
  {
    path: 'type',
    label: 'Entity type',
    type: 'enum',
    section: 'about',
    searchable: true,
    filterable: true,
    listable: true,
    editable: true,
  },
  {
    path: 'status',
    label: 'Entity status',
    type: 'enum',
    section: 'about',
    searchable: true,
    filterable: true,
    listable: true,
    editable: true,
  },
  {
    path: 'externalId',
    label: 'External ID',
    type: 'text',
    section: 'identity',
    searchable: true,
    filterable: true,
    editable: true,
  },
  { path: 'metadata', label: 'Metadata', type: 'array', section: 'about', searchable: true, editable: true },
  { path: 'sync', label: 'Sync state', type: 'object', section: 'system', system: true, editable: false },
  { path: 'data', label: 'Data', type: 'object', section: 'about', editable: true },
  { path: 'data.location', label: 'Location', type: 'object', section: 'about', editable: true },
  {
    path: 'data.location.address',
    label: 'Address',
    type: 'text',
    section: 'about',
    searchable: true,
    filterable: true,
    editable: true,
  },
  {
    path: 'data.location.city',
    label: 'City',
    type: 'text',
    section: 'about',
    searchable: true,
    filterable: true,
    listable: true,
    editable: true,
  },
  {
    path: 'data.location.country',
    label: 'Country',
    type: 'text',
    section: 'about',
    searchable: true,
    filterable: true,
    editable: true,
  },
  { path: 'data.location.latitude', label: 'Latitude', type: 'number', section: 'about', editable: true },
  { path: 'data.location.longitude', label: 'Longitude', type: 'number', section: 'about', editable: true },
  { path: 'data.address', label: 'Address', type: 'object', section: 'about', editable: true },
  { path: 'data.address.street', label: 'Street', type: 'text', section: 'about', searchable: true, editable: true },
  {
    path: 'data.address.city',
    label: 'City',
    type: 'text',
    section: 'about',
    searchable: true,
    filterable: true,
    listable: true,
    editable: true,
  },
  {
    path: 'data.formatted_address',
    label: 'Formatted address',
    type: 'text',
    section: 'about',
    searchable: true,
    editable: true,
  },
  {
    path: 'data.place_id',
    label: 'Google Place ID',
    type: 'text',
    section: 'identity',
    searchable: true,
    filterable: true,
    editable: false,
  },
  {
    path: 'data.cuisine',
    label: 'Cuisine',
    type: 'text',
    section: 'about',
    searchable: true,
    filterable: true,
    editable: true,
  },
  { path: 'data.description', label: 'Description', type: 'longText', section: 'about', searchable: true, editable: true },
  { path: 'data.rating', label: 'Rating', type: 'number', section: 'about', filterable: true, editable: true },
  {
    path: 'data.google_rating',
    label: 'Google rating',
    type: 'number',
    section: 'about',
    filterable: true,
    editable: true,
  },
  {
    path: 'data.types',
    label: 'Place types',
    type: 'array',
    section: 'about',
    searchable: true,
    filterable: true,
    editable: true,
  },
  { path: 'data.website', label: 'Website', type: 'text', section: 'about', searchable: true, editable: true },
  { path: 'data.phone', label: 'Phone', type: 'text', section: 'about', searchable: true, editable: true },
  { path: 'data.contacts', label: 'Contacts', type: 'object', section: 'about', editable: true },
  { path: 'data.contacts.phone', label: 'Phone', type: 'text', section: 'about', searchable: true, editable: true },
  { path: 'data.contacts.website', label: 'Website', type: 'text', section: 'about', searchable: true, editable: true },
  { path: 'data.media', label: 'Media', type: 'array', section: 'media', editable: true },
  { path: 'data.media.photos', label: 'Photos', type: 'array', section: 'media', editable: true },
  {
    path: 'createdAt',
    label: 'Created at',
    type: 'dateTime',
    section: 'history',
    filterable: true,
    system: true,
    editable: false,
  },
  {
    path: 'updatedAt',
    label: 'Updated at',
    type: 'dateTime',
    section: 'history',
    filterable: true,
    system: true,
    editable: false,
  },
  { path: 'createdBy', label: 'Created by', type: 'text', section: 'history', searchable: true, system: true, editable: false },
  { path: 'updatedBy', label: 'Updated by', type: 'text', section: 'history', searchable: true, system: true, editable: false },
  { path: 'version', label: 'Version', type: 'number', section: 'system', filterable: true, system: true, editable: false },
])

/** `categories.<concept>` is open by design: the concept vocabulary lives in Mongo, not here. */
function dynamicField(kind: ContentKind, path: string): FieldDescriptor | undefined {
  if (kind !== 'curation') return undefined
  const segments = pathSegments(path)
  if (segments.length !== 2 || segments[0] !== 'categories') return undefined
  return {
    path,
    label: humanizeSegment(segments[1]),
    owner: 'curation',
    type: 'concept',
    section: 'concepts',
    searchable: true,
    filterable: true,
    editable: true,
  }
}

function humanizeSegment(segment: string): string {
  const spaced = segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\bid\b/gi, 'ID')
    .trim()
  if (spaced === '') return segment
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function findFieldDescriptor(kind: ContentKind, path: string): FieldDescriptor | undefined {
  const registry = kind === 'entity' ? ENTITY_FIELDS : CURATION_FIELDS
  const registered = registry.find((field) => field.path === path)
  return registered ?? dynamicField(kind, path)
}

/** Unregistered paths stay visible: the Inspector never hides backend fields. */
export function describeField(kind: 'curation' | 'entity', path: string): FieldDescriptor {
  const known = findFieldDescriptor(kind, path)
  if (known) return known
  const segments = pathSegments(path)
  return {
    path,
    label: humanizeSegment(segments.length > 0 ? segments[segments.length - 1] : path),
    owner: kind === 'entity' ? 'entity' : 'curation',
    type: 'json',
    section: 'other',
  }
}
