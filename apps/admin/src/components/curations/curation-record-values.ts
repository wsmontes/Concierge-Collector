/**
 * Value readers for the Curation full record page (plan §13–§19, §26, §34, §46).
 *
 * The record is the only source here: a Curation arrives as decoded JSON with
 * current and legacy shapes side by side, so the page reads field by field
 * instead of assuming one schema, and it never invents a value the record does
 * not carry. Containers the page has no vocabulary for still surface — as
 * metadata rows — because "nothing disappears" is the point of the surface.
 */

import { humanizeFieldName } from '../../content/field-types'
import { isRecord } from '../../content/value-guards'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'

/** How a `sources` bucket is presented: a media list, or generic provenance. */
export type SourceKind = 'image' | 'audio' | 'other'

/** Stored bucket names the Collector writes. Anything else stays visible as other. */
const SOURCE_KIND: Record<string, SourceKind | undefined> = {
  image: 'image',
  images: 'image',
  photo: 'image',
  photos: 'image',
  audio: 'audio',
  voice: 'audio',
}

/** Human labels for the provenance keys the Collector stores in a source entry. */
const SOURCE_FIELD_LABEL: Record<string, string | undefined> = {
  source_id: 'Source id',
  type: 'Type',
  capture_type: 'Capture',
  source: 'Source',
  url: 'URL',
  original_url: 'Original URL',
  thumbnail_url: 'Thumbnail URL',
  filename: 'Filename',
  file_name: 'Filename',
  mime_type: 'Media type',
  width: 'Width',
  height: 'Height',
  dimensions: 'Dimensions',
  size_bytes: 'Size (bytes)',
  bytes: 'Size (bytes)',
  status: 'Status',
  processing_status: 'Processing',
  processing_error: 'Error',
  lastError: 'Error',
  analysis_model: 'Analysis model',
  transcription_model: 'Transcription model',
  model: 'Model',
  language: 'Language',
  source_language: 'Spoken language',
  duration_seconds: 'Duration (s)',
  duration: 'Duration',
  curator_id: 'Curator',
  captured_at: 'Captured',
  created_at: 'Created',
  analyzed_at: 'Analyzed',
  processed_at: 'Processed',
  processing_started_at: 'Processing started',
  legacy: 'Legacy entry',
}

/** Transcript text is shown as a transcript, never as one metadata row. */
const MEDIA_TEXT_FIELD: Record<string, true | undefined> = {
  transcript: true,
  text: true,
}

/** The keys a Curation's authorship lives under, newest shape first. */
export const CREATED_AT_KEYS = ['createdAt', 'created_at'] as const
export const UPDATED_AT_KEYS = ['updatedAt', 'updated_at'] as const

const TIMESTAMP_FIELD = /(_at|At)$/
/** Stored names whose value is an identifier, a hash or a path: shown in mono. */
const TECHNICAL_FIELD = /(^|_)(id|uuid|hash|checksum|sha\d*|path|slug|url|key)$/i
const DURATION_SECONDS = /^\d+(\.\d+)?$/
const LINKABLE_URL = /^(https?:|data:)/

/** The last segment of a stored path: `sources.audio[0].source_id` → `source_id`. */
function lastName(path: string): string {
  const cut = Math.max(path.lastIndexOf('.'), path.lastIndexOf(']'))
  return cut === -1 ? path : path.slice(cut + 1)
}

/**
 * Whether a stored field name — or a full field path — holds a timestamp
 * (`_at`/`At`), the shape the Collector and Payload both write. The page reads
 * it as a time, never as a run of digits.
 */
export function isTimestampName(path: string): boolean {
  return TIMESTAMP_FIELD.test(lastName(path))
}

/** Whether a stored field name or path holds a technical value: id, hash, path, URL. */
export function isTechnicalName(path: string): boolean {
  return TECHNICAL_FIELD.test(lastName(path))
}

export interface MetadataRow {
  label: string
  value: string
  /** Absolute rendering of a timestamp value, for the row's `title`. */
  title?: string
  /** Technical value (id, hash, path): the row renders it in mono. */
  mono?: boolean
}

export interface SourceEntryView {
  /** A URL the *entry* stores — the page never builds one. */
  url: string | null
  filename: string | null
  durationSeconds: number | null
  transcript: string | null
  status: string | null
  rows: MetadataRow[]
}

export interface SourceBucket {
  key: string
  kind: SourceKind
  entries: unknown[]
}

export interface ConceptGroup {
  category: string
  values: string[]
}

export interface CurationEntityContext {
  entityId: string | null
  name: string | null
  type: string | null
  city: string | null
}

export interface CurationCuratorContext {
  kind: 'Human' | 'Synthetic'
  name: string | null
}

/** A stored non-empty string, or null. */
export function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.trim().length > 0 ? value : null
}

/** Display text for a scalar; null for containers, blank strings and null. */
function scalarText(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return asString(value)
}

/** Whether a stored value holds nothing the page can show. */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  if (isRecord(value)) return Object.keys(value).length === 0
  return false
}

/** Readable text of any stored value: pretty JSON for containers, text for scalars. */
export function readableText(value: unknown): string {
  if (isBlank(value)) return 'Not set'
  if (isRecord(value) || Array.isArray(value)) return JSON.stringify(value, null, 2) ?? 'Not set'
  return scalarText(value) ?? String(value)
}

/** The first of `keys` whose stored value carries something readable. */
export function firstValue(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (!isBlank(record[key])) return record[key]
  }
  return undefined
}

/**
 * A stored timestamp as the page shows it: relative in the text, absolute in
 * the `title` — an editor reads "3 days ago" and still gets the exact instant.
 * Null when the value is not a stored date.
 */
export function timestampLabels(value: unknown): { relative: string; absolute: string | null } | null {
  const stored = asString(value)
  if (stored === null) return null
  const absolute = formatAbsoluteDate(stored)
  if (absolute === null) return null
  return { relative: formatRelativeDate(stored), absolute }
}

/** `03:42`, `1:02:07` — the plan asks for a duration, not for raw seconds. */
export function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = String(total % 60).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
  return `${String(minutes).padStart(2, '0')}:${remainder}`
}

/**
 * The optimistic-lock version the page opened. `version` defaults to 1 in the
 * Curation schema, so a document that never carried one is still version 1 for
 * the PATCH precondition.
 */
export function recordVersion(record: Record<string, unknown>): number {
  const stored = record.version
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored
  return 1
}

/**
 * The Entity this Curation points at. A record may carry only `entity_id`, so
 * every other member stays null and the page keeps the id as secondary text.
 * `city` and `type` are the Curation's denormalized projection of the Entity.
 */
export function entityContext(record: Record<string, unknown>): CurationEntityContext {
  const nested = isRecord(record.entity) ? record.entity : null
  return {
    entityId: asString(record.entity_id),
    name: asString(record.entity_name) ?? (nested === null ? null : asString(nested.name)),
    type: asString(record.type) ?? (nested === null ? null : asString(nested.type)),
    city: asString(record.city) ?? (nested === null ? null : asString(nested.city)),
  }
}

/** Who wrote the Curation, and whether that author is a person or a pipeline. */
export function curatorContext(record: Record<string, unknown>): CurationCuratorContext {
  const nested = isRecord(record.curator) ? record.curator : null
  return {
    kind: record.curator_type === 'synthetic' ? 'Synthetic' : 'Human',
    name: (nested === null ? null : asString(nested.name)) ?? asString(record.curator_id),
  }
}

function conceptValue(entry: unknown): string | null {
  const text = scalarText(entry)
  if (text !== null) return text
  if (isRecord(entry)) {
    return asString(entry.value) ?? asString(entry.name) ?? asString(entry.label) ?? JSON.stringify(entry)
  }
  if (entry === null || entry === undefined) return null
  return JSON.stringify(entry) ?? null
}

/**
 * `categories` is `{ [Category]: value[] }` and the categories come from the
 * database, so this never names one — the UI must not hardcode the current set.
 */
export function conceptGroups(record: Record<string, unknown>): ConceptGroup[] {
  const categories = record.categories
  if (!isRecord(categories)) return []
  const groups: ConceptGroup[] = []
  for (const [category, stored] of Object.entries(categories)) {
    const values: string[] = []
    for (const entry of Array.isArray(stored) ? stored : [stored]) {
      const value = conceptValue(entry)
      if (value !== null) values.push(value)
    }
    groups.push({ category, values })
  }
  return groups
}

/** The `sources` buckets the record stores, classified for the media section. */
export function sourceBuckets(record: Record<string, unknown>): SourceBucket[] {
  const sources = record.sources
  if (!isRecord(sources)) return []
  const buckets: SourceBucket[] = []
  for (const [key, stored] of Object.entries(sources)) {
    const entries = Array.isArray(stored) ? stored : isRecord(stored) ? [stored] : []
    const kind = SOURCE_KIND[key.trim().toLocaleLowerCase()] ?? 'other'
    buckets.push({ key, kind, entries })
  }
  return buckets
}

function storedUrlIn(entry: Record<string, unknown>): string | null {
  for (const key of ['url', 'original_url', 'thumbnail_url', 'href']) {
    const value = asString(entry[key])
    if (value !== null && LINKABLE_URL.test(value)) return value
  }
  return null
}

function durationIn(entry: Record<string, unknown>): number | null {
  const stored = entry.duration_seconds ?? entry.duration
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored
  if (typeof stored === 'string' && DURATION_SECONDS.test(stored.trim())) return Number(stored)
  return null
}

/**
 * Everything the media section shows about one stored source entry. Text-valued
 * provenance (the transcript) is lifted out of the metadata rows so a long
 * transcript does not turn a provenance list into a wall of text.
 */
export function sourceEntryView(entry: unknown): SourceEntryView {
  const rows = metadataRows(entry)
  if (!isRecord(entry)) {
    return { url: null, filename: null, durationSeconds: null, transcript: null, status: null, rows }
  }
  return {
    url: storedUrlIn(entry),
    filename: asString(entry.filename) ?? asString(entry.file_name),
    durationSeconds: durationIn(entry),
    transcript: asString(entry.transcript) ?? asString(entry.text),
    status: asString(entry.status) ?? asString(entry.processing_status) ?? asString(entry.processing_error),
    rows,
  }
}

/** Every stored row of one source entry, or of any object, as label/value pairs. */
function metadataRows(entry: unknown): MetadataRow[] {
  if (!isRecord(entry)) {
    const text = scalarText(entry)
    return text === null ? [] : [{ label: 'Value', value: text }]
  }
  const rows: MetadataRow[] = []
  for (const [key, value] of Object.entries(entry)) {
    if (MEDIA_TEXT_FIELD[key] === true || isBlank(value)) continue
    const label = SOURCE_FIELD_LABEL[key] ?? humanizeFieldName(key)
    const mono = isTechnicalName(key)
    // A stored time reads as "3 days ago" and carries the instant in `title`.
    const timestamp = isTimestampName(key) ? timestampLabels(value) : null
    if (timestamp !== null) {
      rows.push({ label, value: timestamp.relative, title: timestamp.absolute ?? undefined, mono })
      continue
    }
    rows.push({ label, value: readableText(value), mono })
  }
  return rows
}
