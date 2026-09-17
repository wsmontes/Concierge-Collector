'use client'

import type { ReactNode } from 'react'
import type { CurationCollectionLink } from '../../content/record-types'
import { Card, FactList } from '../ui/Card'
import { Chip } from '../ui/Chip'
import { StatusPill } from '../ui/StatusPill'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'
import { CurationCopyButton } from './CurationCopyButton'
import { CurationLink, type CurationNavigate } from './CurationLink'
import {
  asString,
  conceptGroups,
  CREATED_AT_KEYS,
  curatorContext,
  entityContext,
  firstValue,
  recordVersion,
  sourceBuckets,
  UPDATED_AT_KEYS,
  type CurationCuratorContext,
  type CurationEntityContext,
} from './curation-record-values'

/** A stored timestamp: relative in the text, absolute in the `title`. */
function StoredTime({ value, fallback = 'Not recorded' }: { value: string | null; fallback?: string }): ReactNode {
  if (value === null) return <>{fallback}</>
  return <time dateTime={value} title={formatAbsoluteDate(value) ?? undefined}>{formatRelativeDate(value)}</time>
}

/**
 * The one-line identity of the record: type of curator, status, provenance.
 *
 * The chips answer "what state is this in" and the facts answer "which records
 * does it point at"; the page title above already carries the name, so this
 * block never repeats it as a heading.
 */
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
  const curationId = asString(record.curation_id)

  return (
    <section className="ui-record-identity" aria-label="Curation record">
      <div className="ui-record-identity__chips">
        <StatusPill status={status} />
        <Chip size="sm" tone={entity.entityId === null ? 'warning' : 'neutral'}>
          {entity.entityId === null ? 'Not linked' : 'Linked'}
        </Chip>
        <Chip size="sm" tone="neutral">{curator.kind}</Chip>
      </div>
      <dl className="ui-record-identity__facts">
        <div className="ui-record-identity__fact">
          <dt>Entity</dt>
          <dd>
            {entity.entityId === null
              ? 'Not linked to an Entity'
              : (
                  <CurationLink href={`/admin/entities/${encodeURIComponent(entity.entityId)}`} navigate={navigate}>
                    {entity.name ?? entity.entityId}
                  </CurationLink>
                )}
          </dd>
        </div>
        <div className="ui-record-identity__fact">
          <dt>Curator</dt>
          <dd>{curator.name ?? 'Unknown curator'} · {curator.kind}</dd>
        </div>
        <div className="ui-record-identity__fact">
          <dt>Updated</dt>
          <dd><StoredTime value={updatedAt} /></dd>
        </div>
        <div className="ui-record-identity__fact">
          <dt>Version</dt>
          <dd>{recordVersion(record)}</dd>
        </div>
        {curationId !== null && (
          <div className="ui-record-identity__fact">
            <dt>Curation id</dt>
            <dd>
              <span className="ui-detail-mono">{curationId}</span>
              <CurationCopyButton label="Copy id" text={curationId} />
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}

/**
 * The rail: what the record points at (facts) and what it stores (metadata).
 * Every row is read from the record — a fact the record does not carry says so
 * instead of showing a dash that could be read as "empty on purpose".
 */
export function CurationRecordFacts({
  record,
  collections,
  navigate,
}: {
  record: Record<string, unknown>
  collections: readonly CurationCollectionLink[]
  navigate?: CurationNavigate
}): ReactNode {
  const entity = entityContext(record)
  const curator = curatorContext(record)
  const groups = conceptGroups(record)
  const buckets = sourceBuckets(record)
  const counts = { image: 0, audio: 0, other: 0 }
  for (const bucket of buckets) counts[bucket.kind] += bucket.entries.length

  const createdAt = asString(firstValue(record, CREATED_AT_KEYS))
  const updatedAt = asString(firstValue(record, UPDATED_AT_KEYS))
  const createdBy = asString(record.createdBy) ?? asString(record.created_by)
  const updatedBy = asString(record.updatedBy) ?? asString(record.updated_by)
  const curationId = asString(record.curation_id)
  const transcript = asString(record.transcript)

  return (
    <div className="ui-record-rail">
      <Card title="Facts">
        <FactList
          facts={[
            {
              label: 'Entity',
              value: entity.entityId === null
                ? 'Not linked to an Entity'
                : (
                    <CurationLink href={`/admin/entities/${encodeURIComponent(entity.entityId)}`} navigate={navigate}>
                      {entity.name ?? entity.entityId}
                    </CurationLink>
                  ),
            },
            { label: 'Curator', value: `${curator.name ?? 'Unknown curator'} · ${curator.kind}` },
            { label: 'Collections', value: collections.length === 0 ? 'None' : `${collections.length} linked` },
            { label: 'Captured images', value: counts.image },
            { label: 'Captured audio', value: counts.audio },
            { label: 'Other evidence', value: counts.other },
            { label: 'Concepts', value: groups.length === 0 ? 'None' : `${groups.length} categories` },
            { label: 'Transcript', value: transcript === null ? 'Not stored' : 'Stored' },
          ]}
        />
      </Card>
      <Card title="Metadata">
        <FactList
          facts={[
            {
              label: 'Curation id',
              value: curationId === null
                ? 'Not recorded'
                : <span className="ui-detail-mono">{curationId}</span>,
            },
            {
              label: 'Entity id',
              value: entity.entityId === null
                ? 'Not linked'
                : <span className="ui-detail-mono">{entity.entityId}</span>,
            },
            { label: 'Version', value: recordVersion(record) },
            { label: 'Created', value: <StoredTime value={createdAt} /> },
            { label: 'Updated', value: <StoredTime value={updatedAt} /> },
            {
              label: 'Created by',
              value: createdBy === null ? 'Not recorded' : <span className="ui-detail-mono">{createdBy}</span>,
            },
            {
              label: 'Updated by',
              value: updatedBy === null ? 'Not recorded' : <span className="ui-detail-mono">{updatedBy}</span>,
            },
            { label: 'Stored keys', value: Object.keys(record).length },
          ]}
        />
      </Card>
    </div>
  )
}
