'use client'

import type { ReactNode } from 'react'
import { StatusPill } from '../ui/StatusPill'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'
import { CurationLink, type CurationNavigate } from './CurationLink'
import {
  asString,
  firstValue,
  recordVersion,
  UPDATED_AT_KEYS,
  type CurationCuratorContext,
  type CurationEntityContext,
} from './curation-record-values'

/** The one-line identity of the record: type of curator, status, provenance. */
export function CurationRecordHeader({
  record,
  entity,
  curator,
  navigate,
}: {
  record: Record<string, unknown>
  entity: CurationEntityContext
  curator: CurationCuratorContext
  navigate?: CurationNavigate
}): ReactNode {
  const status = asString(record.status) ?? 'unknown'
  const updatedAt = asString(firstValue(record, UPDATED_AT_KEYS))
  const absolute = formatAbsoluteDate(updatedAt)
  const curationId = asString(record.curation_id)

  return (
    <section className="curation-header" aria-label="Curation record">
      <dl className="curation-header__meta">
        <div className="curation-header__item">
          <dt>Status</dt>
          <dd><StatusPill status={status} /></dd>
        </div>
        <div className="curation-header__item" data-linked={entity.entityId !== null}>
          <dt>Entity</dt>
          <dd>
            {entity.entityId === null
              ? 'Not linked to an Entity'
              : <CurationLink href={`/admin/entities/${encodeURIComponent(entity.entityId)}`} navigate={navigate}>
                  {entity.name ?? entity.entityId}
                </CurationLink>}
          </dd>
        </div>
        <div className="curation-header__item">
          <dt>Curator</dt>
          <dd>{curator.name ?? 'Unknown curator'} · {curator.kind}</dd>
        </div>
        <div className="curation-header__item">
          <dt>Last update</dt>
          <dd>{absolute === null ? 'Unknown' : <time dateTime={updatedAt ?? undefined} title={absolute}>{formatRelativeDate(updatedAt)}</time>}</dd>
        </div>
        <div className="curation-header__item">
          <dt>Version</dt>
          <dd>{recordVersion(record)}</dd>
        </div>
        {curationId !== null && (
          <div className="curation-header__item">
            <dt>Curation id</dt>
            <dd className="curation-header__id">{curationId}</dd>
          </div>
        )}
      </dl>
    </section>
  )
}

