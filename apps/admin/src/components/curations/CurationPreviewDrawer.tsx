'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getFieldValue } from '../../content/field-path'
import type { CurationCollectionLink, CurationRecordResponse, LoadCurationRecord } from '../../content/record-types'
import { isRecord } from '../../content/value-guards'
import type { AdminCurationRow } from '../../explorer/types'
import { AdminSection } from '../ui/AdminPage'
import { StatusPill } from '../ui/StatusPill'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'

export interface CurationPreviewDrawerProps {
  row: AdminCurationRow
  loadRecord: LoadCurationRecord
  onClose: () => void
  /** Editor URL of the full record; no `Edit` control renders without it. */
  editHref?: string | null
}

interface ConceptGroup {
  category: string
  values: string[]
}

/** Everything the drawer shows, read from the stored record — never invented. */
interface CurationPreview {
  curationId: string
  curatorType: string | null
  status: string | null
  entityId: string | null
  entityName: string | null
  entityPlace: string | null
  curator: string | null
  summary: string | null
  concepts: ConceptGroup[]
  audio: number | null
  images: number | null
  transcript: 'Available' | 'Not available' | null
  collections: CurationCollectionLink[]
  updatedAt: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function listLength(container: unknown, key: string): number | null {
  if (!isRecord(container)) return null
  const value = container[key]
  return Array.isArray(value) ? value.length : null
}

function conceptGroups(value: unknown): ConceptGroup[] {
  if (!isRecord(value)) return []
  return Object.entries(value)
    .map(([category, raw]) => ({ category, values: stringList(raw) }))
    .filter((group) => group.values.length > 0)
}

function previewOf(response: CurationRecordResponse, row: AdminCurationRow): CurationPreview {
  const { record, collections } = response
  const sources = getFieldValue(record, 'sources')
  const transcript = text(getFieldValue(record, 'transcript')) ?? text(getFieldValue(record, 'sources.audio[0].transcript'))
  const notes = getFieldValue(record, 'notes')
  const place = [
    text(getFieldValue(record, 'city')) ?? row.city,
    text(getFieldValue(record, 'type')) ?? row.entity_type,
  ].filter((part): part is string => part !== null)
  return {
    curationId: text(getFieldValue(record, 'curation_id')) ?? row.curation_id,
    curatorType: text(getFieldValue(record, 'curator_type')),
    status: text(getFieldValue(record, 'status')) ?? row.status,
    entityId: text(getFieldValue(record, 'entity_id')),
    entityName: text(getFieldValue(record, 'restaurant_name')) ?? row.restaurant_name,
    entityPlace: place.length > 0 ? place.join(' · ') : null,
    curator: text(getFieldValue(record, 'curator.name')) ?? row.curator_name ?? row.curator_id,
    summary: text(getFieldValue(record, 'notes.public')) ?? text(notes),
    concepts: conceptGroups(getFieldValue(record, 'categories')),
    audio: listLength(sources, 'audio'),
    images: listLength(sources, 'image'),
    transcript: transcript ? 'Available' : isRecord(sources) ? 'Not available' : null,
    collections,
    updatedAt: text(getFieldValue(record, 'updatedAt')) ?? row.updated_at,
  }
}

/**
 * Side preview of one Curation: the list keeps its context, the operator sees
 * enough to identify the record, and the full page is one deliberate click
 * away. Escape and the Close control close it; scrolling the page behind it
 * must not.
 *
 * The owner remounts this drawer per Curation (`key`), which is what returns
 * the loading state to a fresh record.
 */
export function CurationPreviewDrawer({ row, loadRecord, onClose, editHref = null }: CurationPreviewDrawerProps) {
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [preview, setPreview] = useState<CurationPreview | null>(null)

  useEffect(() => {
    let active = true
    void loadRecord(row.curation_id).then(
      (response) => {
        if (!active) return
        setPreview(previewOf(response, row))
        setLoading(false)
      },
      () => {
        if (!active) return
        setFailed(true)
        setLoading(false)
      },
    )
    return () => { active = false }
  }, [loadRecord, row])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <aside aria-labelledby="curation-preview-title" className="curation-drawer" role="dialog">
      <header className="curation-drawer__header">
        <div className="curation-drawer__heading">
          <h2 id="curation-preview-title">{preview?.entityName ?? row.restaurant_name ?? row.curation_id}</h2>
          <p className="curation-drawer__subtitle">
            {preview?.curatorType && <span>{`${preview.curatorType.charAt(0).toLocaleUpperCase()}${preview.curatorType.slice(1)} Curation`}</span>}
            {preview?.curatorType && <span aria-hidden="true">{' · '}</span>}
            <StatusPill status={preview?.status ?? row.status} />
          </p>
        </div>
        <button className="curation-drawer__close" onClick={onClose} type="button">Close</button>
      </header>

      {loading && <p className="curation-drawer__state" role="status">Loading Curation…</p>}
      {failed && <p className="curation-drawer__state curation-drawer__state--error" role="alert">Unable to load this Curation. Try again.</p>}

      {preview && (
        <div className="curation-drawer__body">
          <AdminSection title="Entity">
            {preview.entityId ? (
              <>
                <p className="curation-drawer__value">{preview.entityName ?? '—'}</p>
                <p className="curation-drawer__muted">{preview.entityPlace ?? '—'}</p>
                <Link href={`/admin/entities/${encodeURIComponent(preview.entityId)}`}>View Entity →</Link>
              </>
            ) : (
              <>
                <p className="curation-drawer__label">Working name</p>
                <p className="curation-drawer__value">{preview.entityName ?? '—'}</p>
                <Link
                  className="curation-drawer__link"
                  href={`/admin/entities?q=${encodeURIComponent(preview.entityName ?? row.curation_id)}`}
                >
                  Find and link Entity
                </Link>
              </>
            )}
          </AdminSection>

          <AdminSection title="Curator">
            <p className="curation-drawer__value">{preview.curator ?? '—'}</p>
          </AdminSection>

          <AdminSection title="Public recommendation">
            {preview.summary
              ? <p className="curation-drawer__summary">{preview.summary}</p>
              : <p className="curation-drawer__muted">No public recommendation recorded.</p>}
          </AdminSection>

          <AdminSection title="Concepts">
            {preview.concepts.length === 0
              ? <p className="curation-drawer__muted">No concepts recorded.</p>
              : (
                <dl className="curation-drawer__concepts">
                  {preview.concepts.map((group) => (
                    <div className="curation-drawer__concept" key={group.category}>
                      <dt>{group.category}</dt>
                      <dd>{group.values.join(' · ')}</dd>
                    </div>
                  ))}
                </dl>
              )}
          </AdminSection>

          <AdminSection title="Sources">
            <dl className="curation-drawer__facts">
              <div><dt>Audio</dt><dd>{preview.audio ?? '—'}</dd></div>
              <div><dt>Images</dt><dd>{preview.images ?? '—'}</dd></div>
              <div><dt>Transcript</dt><dd>{preview.transcript ?? '—'}</dd></div>
            </dl>
          </AdminSection>

          <AdminSection title="Collections">
            {preview.collections.length === 0
              ? <p className="curation-drawer__muted">Not in any Collection.</p>
              : (
                <ul className="curation-drawer__collections">
                  {preview.collections.map((link) => (
                    <li key={link.collection_id}>
                      <Link href={`/admin/collections/collections/${encodeURIComponent(link.collection_id)}`}>{link.title}</Link>
                      {typeof link.current_published_version === 'number' && (
                        <span className="curation-drawer__muted">{`v${link.current_published_version}`}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
          </AdminSection>

          <AdminSection title="Updated">
            {preview.updatedAt
              ? (
                <time dateTime={preview.updatedAt} title={formatAbsoluteDate(preview.updatedAt) ?? undefined}>
                  {formatRelativeDate(preview.updatedAt)}
                </time>
              )
              : <p className="curation-drawer__muted">—</p>}
          </AdminSection>
        </div>
      )}

      <footer className="curation-drawer__actions">
        <Link className="curation-drawer__primary" href={`/admin/curations/${encodeURIComponent(preview?.curationId ?? row.curation_id)}`}>
          Open full Curation
        </Link>
        {editHref && <Link className="curation-drawer__secondary" href={editHref}>Edit</Link>}
      </footer>
    </aside>
  )
}
