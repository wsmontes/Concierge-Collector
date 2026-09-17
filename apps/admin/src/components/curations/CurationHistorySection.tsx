'use client'

import type { ReactNode } from 'react'
import { AdminSection } from '../ui/AdminPage'
import { FactList } from '../ui/Card'
import { InlineNotice } from '../ui/InlineNotice'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'
import {
  asString,
  CREATED_AT_KEYS,
  curatorContext,
  firstValue,
  readableText,
  recordVersion,
  UPDATED_AT_KEYS,
} from './curation-record-values'

/** Stored keys that would hold a change list or a snapshot set, if any exist. */
const HISTORY_KEY: Record<string, true | undefined> = {
  history: true,
  versions: true,
  snapshots: true,
  audit: true,
  audit_events: true,
  changes: true,
}

function Timestamp({ value, fallback }: { value: string | null; fallback: string }): ReactNode {
  if (value === null) return <>{fallback}</>
  return <time dateTime={value} title={formatAbsoluteDate(value) ?? undefined}>{formatRelativeDate(value)}</time>
}

/**
 * History (plan §46). The section shows the authorship the record actually
 * stores; when no change list is stored it says so and names what is available
 * instead of drawing a version comparison out of nothing.
 */
export function CurationHistorySection({ record }: { record: Record<string, unknown> }): ReactNode {
  const curator = curatorContext(record)
  const createdAt = asString(firstValue(record, CREATED_AT_KEYS))
  const updatedAt = asString(firstValue(record, UPDATED_AT_KEYS))
  const createdBy = asString(record.createdBy) ?? asString(record.created_by)
  const updatedBy = asString(record.updatedBy) ?? asString(record.updated_by)
  const status = asString(record.status)
  const version = recordVersion(record)

  const storedHistory: { key: string; value: unknown }[] = []
  for (const key of Object.keys(record)) {
    if (HISTORY_KEY[key] === true) storedHistory.push({ key, value: record[key] })
  }

  const facts: Array<{ label: string; value: ReactNode }> = [
    { label: 'Created by', value: createdBy === null ? 'Not recorded' : <span className="ui-detail-mono">{createdBy}</span> },
    { label: 'Updated by', value: updatedBy === null ? 'Not recorded' : <span className="ui-detail-mono">{updatedBy}</span> },
    { label: 'Version', value: version },
    { label: 'Curator', value: `${curator.name ?? 'Unknown curator'} · ${curator.kind}` },
  ]
  if (status !== null) facts.push({ label: 'Status', value: status })

  const events = [
    createdAt === null
      ? null
      : { key: 'created', label: 'Created', at: createdAt, by: createdBy },
    updatedAt === null
      ? null
      : { key: 'updated', label: 'Updated', at: updatedAt, by: updatedBy },
  ].filter((event): event is { key: string; label: string; at: string; by: string | null } => event !== null)

  return (
    <AdminSection title="History" description="Who wrote this Curation, and when.">
      {events.length === 0
        ? <p className="ui-history__none">The record stores no creation or update timestamp.</p>
        : (
            <ol className="ui-timeline">
              {events.map((event) => (
                <li className="ui-timeline__item" key={event.key}>
                  <span className="ui-timeline__marker" aria-hidden="true" />
                  <div className="ui-timeline__body">
                    <p className="ui-timeline__title">{event.label}</p>
                    <p className="ui-timeline__time">
                      <Timestamp value={event.at} fallback="Not recorded" />
                    </p>
                    {event.by !== null && (
                      <p className="ui-timeline__by ui-detail-mono">{event.by}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
      <FactList facts={facts} className="ui-history__facts" />
      {storedHistory.length === 0
        ? (
            <InlineNotice tone="info">
              This record stores the current version only. The Admin keeps no Curation snapshots yet, so there
              is no version comparison to show — version {version} and the authorship above are what is available.
            </InlineNotice>
          )
        : (
            <div className="ui-history__stored">
              <h3>Stored change history</h3>
              {storedHistory.map((entry) => (
                <div className="ui-history__entry" key={entry.key}>
                  <h4>{entry.key}</h4>
                  <pre className="ui-detail-pre">{readableText(entry.value)}</pre>
                </div>
              ))}
            </div>
          )}
    </AdminSection>
  )
}
