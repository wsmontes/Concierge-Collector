'use client'

import type { ReactNode } from 'react'
import { AdminSection } from '../ui/AdminPage'
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

function Timestamp({ value }: { value: string | null }): ReactNode {
  if (value === null) return <>Not recorded</>
  const absolute = formatAbsoluteDate(value)
  return <time dateTime={value} title={absolute ?? undefined}>{formatRelativeDate(value)}</time>
}

function HistoryRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="curation-history__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
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

  return (
    <AdminSection title="History" description="Who wrote this Curation, and when.">
      <dl className="curation-history">
        <HistoryRow label="Created by">{createdBy ?? 'Not recorded'}</HistoryRow>
        <HistoryRow label="Created"><Timestamp value={createdAt} /></HistoryRow>
        <HistoryRow label="Updated by">{updatedBy ?? 'Not recorded'}</HistoryRow>
        <HistoryRow label="Updated"><Timestamp value={updatedAt} /></HistoryRow>
        <HistoryRow label="Version">{version}</HistoryRow>
        <HistoryRow label="Curator">{curator.name ?? 'Unknown curator'} · {curator.kind}</HistoryRow>
        {status !== null && <HistoryRow label="Status">{status}</HistoryRow>}
      </dl>
      {storedHistory.length === 0
        ? (
            <InlineNotice tone="info">
              This record stores the current version only. The Admin keeps no Curation snapshots yet, so there
              is no version comparison to show — version {version} and the authorship above are what is available.
            </InlineNotice>
          )
        : (
            <div className="curation-history__stored">
              <h3>Stored change history</h3>
              {storedHistory.map((entry) => (
                <div className="curation-history__entry" key={entry.key}>
                  <h4>{entry.key}</h4>
                  <pre>{readableText(entry.value)}</pre>
                </div>
              ))}
            </div>
          )}
    </AdminSection>
  )
}
