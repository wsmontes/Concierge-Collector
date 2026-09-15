'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getFieldValue } from '../../content/field-path'
import type { EntityRow, LoadEntityRecord } from '../../content/record-types'
import { isRecord } from '../../content/value-guards'
import { AdminSection } from '../ui/AdminPage'
import { StatusPill } from '../ui/StatusPill'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'

export interface EntityPreviewDrawerProps {
  entity: EntityRow
  loadRecord: LoadEntityRecord
  onClose: () => void
}

interface MetadataSource {
  label: string
  type: string | null
}

/** Everything the drawer shows, read from the stored record — never invented. */
interface EntityPreview {
  name: string | null
  type: string | null
  status: string | null
  city: string | null
  externalId: string | null
  curations: number | null
  sources: MetadataSource[]
  updatedAt: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** `metadata` entries are `{ type, source, data }`; only identity is rendered here. */
function metadataSource(item: unknown): MetadataSource | null {
  if (typeof item === 'string') return item.trim() ? { label: item, type: null } : null
  if (!isRecord(item)) return null
  const label = text(item.source) ?? text(item.type)
  return label ? { label, type: text(item.type) } : null
}

/**
 * An Entity has no canonical city — it is a projection of the stored `data`
 * blob, so the preview derives it exactly like the read boundary does and
 * labels it as derived.
 */
function previewOf(record: Record<string, unknown>, entity: EntityRow): EntityPreview {
  const data = getFieldValue(record, 'data')
  const metadata = getFieldValue(record, 'metadata')
  const curationsCount = getFieldValue(record, 'curations_count')
  return {
    name: text(getFieldValue(record, 'name')) ?? entity.name,
    type: text(getFieldValue(record, 'type')) ?? entity.type,
    status: text(getFieldValue(record, 'status')) ?? entity.status,
    city: (isRecord(data) ? text(data.city) : null) ?? entity.city,
    externalId: text(getFieldValue(record, 'externalId')),
    curations: typeof curationsCount === 'number' && Number.isFinite(curationsCount)
      ? curationsCount
      : entity.curations_count,
    sources: (Array.isArray(metadata) ? metadata : [])
      .map(metadataSource)
      .filter((entry): entry is MetadataSource => entry !== null),
    updatedAt: text(getFieldValue(record, 'updatedAt')) ?? entity.updated_at,
  }
}

/**
 * Side preview of one Entity: the list keeps its context, the operator sees
 * enough to identify the record, and the full record is one deliberate click
 * away. Escape and the Close control dismiss it. The workspace keys the
 * drawer by Entity id, so every Entity starts from a clean load state.
 */
export function EntityPreviewDrawer({ entity, loadRecord, onClose }: EntityPreviewDrawerProps) {
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [preview, setPreview] = useState<EntityPreview | null>(null)

  useEffect(() => {
    let active = true
    void loadRecord(entity.id).then(
      (response) => {
        if (!active) return
        setPreview(previewOf(response.record, entity))
        setLoading(false)
      },
      () => {
        if (!active) return
        setFailed(true)
        setLoading(false)
      },
    )
    return () => { active = false }
  }, [entity, loadRecord])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const href = `/admin/entities/${encodeURIComponent(entity.id)}`

  return (
    <aside aria-labelledby="entity-preview-title" className="entity-drawer" role="dialog">
      <header className="entity-drawer__header">
        <div className="entity-drawer__heading">
          <h2 id="entity-preview-title">{preview?.name ?? entity.name}</h2>
          <p className="entity-drawer__subtitle"><StatusPill status={preview?.status ?? entity.status} /></p>
        </div>
        <button className="entity-drawer__close" onClick={onClose} type="button">Close</button>
      </header>

      {loading && <p className="entity-drawer__state" role="status">Loading Entity…</p>}
      {failed && <p className="entity-drawer__state entity-drawer__state--error" role="alert">Unable to load this Entity. Try again.</p>}

      {preview && (
        <div className="entity-drawer__body">
          <AdminSection title="Canonical identity">
            <dl className="entity-drawer__facts">
              <div><dt>Name</dt><dd>{preview.name ?? '—'}</dd></div>
              <div><dt>Type</dt><dd>{preview.type ?? '—'}</dd></div>
              <div><dt>Status</dt><dd>{preview.status ?? '—'}</dd></div>
              <div><dt>External id</dt><dd>{preview.externalId ?? '—'}</dd></div>
            </dl>
          </AdminSection>

          <AdminSection title="Location" description="Derived from the Entity's stored data — not a canonical field.">
            <p className="entity-drawer__value">{preview.city ?? '—'}</p>
          </AdminSection>

          <AdminSection title="Curations">
            {preview.curations === null
              ? <p className="entity-drawer__muted">—</p>
              : preview.curations === 0
                ? <p className="entity-drawer__muted">No Curation refers to this Entity yet.</p>
                : (
                  <p className="entity-drawer__value">
                    <Link className="entity-drawer__link" href={href}>
                      {`${preview.curations.toLocaleString()} Curations about this Entity`}
                    </Link>
                  </p>
                )}
          </AdminSection>

          <AdminSection title="Metadata sources">
            {preview.sources.length === 0
              ? <p className="entity-drawer__muted">No metadata source recorded.</p>
              : (
                <ul className="entity-drawer__sources">
                  {preview.sources.map((source, index) => (
                    <li key={`${index}-${source.label}`}>
                      <span className="entity-drawer__value">{source.label}</span>
                      {source.type && source.type !== source.label && (
                        <span className="entity-drawer__muted">{source.type}</span>
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
              : <p className="entity-drawer__muted">—</p>}
          </AdminSection>
        </div>
      )}

      <footer className="entity-drawer__actions">
        <Link className="entity-drawer__primary" href={href}>Open full Entity</Link>
      </footer>
    </aside>
  )
}
