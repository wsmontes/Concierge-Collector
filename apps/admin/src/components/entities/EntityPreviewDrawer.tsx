'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getFieldValue } from '../../content/field-path'
import type { EntityRow, LoadEntityRecord } from '../../content/record-types'
import { isRecord } from '../../content/value-guards'
import { AdminSection } from '../ui/AdminPage'
import { FactList } from '../ui/Card'
import { Chip } from '../ui/Chip'
import { Drawer } from '../ui/Drawer'
import { InlineNotice } from '../ui/InlineNotice'
import { Skeleton } from '../ui/Skeleton'
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

/** Full record route, keyed by the stored id the list already carries. */
function recordHref(entityId: string): string {
  return `/admin/entities/${encodeURIComponent(entityId)}`
}

/**
 * Side preview of one Entity: the list keeps its context, the operator sees
 * enough to identify the record, and the full record is one deliberate click
 * away. The workspace keys the drawer by Entity id, so every Entity starts from
 * a clean load state.
 *
 * The shell is the kit `Drawer` (Payload's, with focus trap and `Esc` in the
 * browser); the body is a separate component so a jsdom test can read it without
 * mounting a modal provider.
 */
export function EntityPreviewDrawer({ entity, loadRecord, onClose }: EntityPreviewDrawerProps): ReactNode {
  return (
    <Drawer onClose={onClose} open title={entity.name}>
      <EntityPreviewPanel entity={entity} loadRecord={loadRecord} />
    </Drawer>
  )
}

/**
 * What the drawer shows. It is read-first and never invents a value: a field the
 * record does not carry says so.
 */
export function EntityPreviewPanel({
  entity,
  loadRecord,
}: {
  entity: EntityRow
  loadRecord: LoadEntityRecord
}): ReactNode {
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

  const href = recordHref(entity.id)

  if (loading) {
    return (
      <div className="entity-preview">
        <p className="ui-visually-hidden" role="status">Loading Entity…</p>
        <Skeleton />
        <Skeleton width="72%" />
        <Skeleton width="48%" />
      </div>
    )
  }

  if (failed || preview === null) {
    return (
      <InlineNotice tone="error">
        <p>Unable to load this Entity. Try again.</p>
      </InlineNotice>
    )
  }

  return (
    <div className="entity-preview">
      <AdminSection title="Canonical identity">
        <FactList
          facts={[
            { label: 'Name', value: preview.name ?? '—' },
            { label: 'Type', value: preview.type ?? '—' },
            {
              label: 'Status',
              value: preview.status === null ? '—' : <StatusPill status={preview.status} />,
            },
            { label: 'External id', value: <span className="ui-table__mono">{preview.externalId ?? '—'}</span> },
          ]}
        />
      </AdminSection>

      <AdminSection title="Location" description="Derived from the Entity's stored data — not a canonical field.">
        <p>{preview.city ?? '—'}</p>
      </AdminSection>

      <AdminSection title="Curations">
        {preview.curations === null
          ? <p className="ui-table__mono">—</p>
          : preview.curations === 0
            ? <p className="ui-table__mono">No Curation refers to this Entity yet.</p>
            : (
              <p>
                <a className="entity-preview__link" href={href}>
                  {`${preview.curations.toLocaleString()} Curations about this Entity`}
                </a>
              </p>
            )}
      </AdminSection>

      <AdminSection title="Metadata sources">
        {preview.sources.length === 0
          ? <p className="ui-table__mono">No metadata source recorded.</p>
          : (
            <ul className="ui-chip-group">
              {preview.sources.map((source, index) => (
                <li key={`${index}-${source.label}`}>
                  <Chip size="sm" tone="info">{source.label}</Chip>
                  {source.type && source.type !== source.label && (
                    <span className="ui-table__mono">{source.type}</span>
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
          : <p className="ui-table__mono">—</p>}
      </AdminSection>

      <div className="entity-preview__actions">
        <Link className="entity-preview__open" href={href}>Open full Entity</Link>
      </div>
    </div>
  )
}
