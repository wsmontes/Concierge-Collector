'use client'

import type { ReactNode } from 'react'
import type { FieldNode } from '../../content/field-types'
import { humanizeFieldName } from '../../content/field-types'
import { AdminSection } from '../ui/AdminPage'
import { EmptyState } from '../ui/EmptyState'
import { CurationFieldBlock, type CurationSectionEditProps } from './CurationFieldBlock'
import {
  durationLabel,
  isBlank,
  sourceEntryView,
  type MetadataRow,
  type SourceBucket,
  type SourceKind,
} from './curation-record-values'

/** `Image`, `Audio`, `Source` — the positional name of an unnamed entry. */
const KIND_LABEL: Record<SourceKind, string> = {
  image: 'Image',
  audio: 'Audio',
  other: 'Source',
}

function MetadataList({ rows }: { rows: MetadataRow[] }): ReactNode {
  if (rows.length === 0) return null
  return (
    <dl className="ui-source__meta">
      {rows.map((row, position) => (
        <div key={position} className="ui-source__meta-row">
          <dt>{row.label}</dt>
          <dd className={row.mono ? 'ui-detail-mono' : undefined} title={row.title}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * One stored source. Nothing here is generated: the title is the stored
 * filename when there is one, the links come from a URL the entry stores, and
 * the facts are the keys the entry actually carries. An entry without a URL is
 * listed as metadata — the plan asks for a thumbnail only when one exists.
 */
function SourceEntry({ entry, index, kind }: { entry: unknown; index: number; kind: SourceKind }): ReactNode {
  const view = sourceEntryView(entry)
  return (
    <li className="ui-source__entry" data-kind={kind}>
      <p className="ui-source__entry-title">{view.filename ?? `${KIND_LABEL[kind]} ${index + 1}`}</p>
      {view.url === null
        ? <p className="ui-source__note">No stored URL for this item; its provenance is listed instead.</p>
        : (
            <p className="ui-source__links">
              <a href={view.url} rel="noreferrer" target="_blank">Open original</a>
              <a href={view.url} download>Download original</a>
            </p>
          )}
      <ul className="ui-source__facts">
        {view.durationSeconds !== null && (
          <li className="ui-detail-mono">Duration {durationLabel(view.durationSeconds)}</li>
        )}
        {view.status !== null && <li>Processing: {view.status}</li>}
        {kind === 'audio' && <li>{view.transcript === null ? 'No transcription stored' : 'Transcription available'}</li>}
      </ul>
      <MetadataList rows={view.rows} />
      {view.transcript !== null && (
        <details className="ui-source__transcription">
          <summary>Stored transcription</summary>
          <pre className="ui-detail-pre">{view.transcript}</pre>
        </details>
      )}
    </li>
  )
}

function bucketEntries(buckets: readonly SourceBucket[]): unknown[] {
  const entries: unknown[] = []
  for (const bucket of buckets) entries.push(...bucket.entries)
  return entries
}

function MediaList({
  title,
  kind,
  buckets,
}: {
  title: string
  kind: SourceKind
  buckets: readonly SourceBucket[]
}): ReactNode {
  const entries = bucketEntries(buckets)
  return (
    <section className="ui-source" aria-label={`Captured ${title.toLocaleLowerCase()}`}>
      <h3 className="ui-source__title">{title}</h3>
      <p className="ui-source__count">{entries.length} stored</p>
      {entries.length === 0
        ? <p className="ui-source__empty">No captured {title.toLocaleLowerCase()} stored for this Curation.</p>
        : (
            <ol className="ui-source__entries">
              {entries.map((entry, index) => <SourceEntry key={index} entry={entry} index={index} kind={kind} />)}
            </ol>
          )}
    </section>
  )
}

/** Sources the page has no media vocabulary for still surface, under their own key. */
function OtherSources({ buckets }: { buckets: readonly SourceBucket[] }): ReactNode {
  return (
    <section className="ui-source" aria-label="Other evidence">
      <h3 className="ui-source__title">Other evidence</h3>
      {buckets.length === 0
        ? <p className="ui-source__empty">No other evidence stored for this Curation.</p>
        : buckets.map((bucket) => (
            <div className="ui-source__bucket" key={bucket.key}>
              <h4 className="ui-source__bucket-title">{humanizeFieldName(bucket.key)}</h4>
              <p className="ui-source__count">{bucket.entries.length} stored</p>
              <ol className="ui-source__entries">
                {bucket.entries.map((entry, index) => (
                  <SourceEntry key={index} entry={entry} index={index} kind="other" />
                ))}
              </ol>
            </div>
          ))}
    </section>
  )
}

/**
 * Media & sources (plan §17, §18). The transcript is the one value with a
 * reading area of its own: readable, copyable and editable in place, without
 * pushing the rest of the provenance off the page.
 */
export function CurationMediaSection({
  buckets,
  transcriptNode,
  edit,
}: {
  buckets: readonly SourceBucket[]
  transcriptNode: FieldNode | null
  edit: CurationSectionEditProps
}): ReactNode {
  const images = buckets.filter((bucket) => bucket.kind === 'image')
  const audio = buckets.filter((bucket) => bucket.kind === 'audio')
  const other = buckets.filter((bucket) => bucket.kind === 'other')
  const hasTranscript = transcriptNode !== null && !isBlank(transcriptNode.value)
  const stored = bucketEntries(buckets).length

  return (
    <AdminSection
      title="Curation evidence"
      description="The photos, audio and text the curator captured for this Curation, exactly as the record stores them. The Entity's own display media is another record and never shows up here."
      action={stored > 0 ? <p className="ui-section-count">{stored} stored</p> : undefined}
    >
      <div className="ui-media">
        {buckets.length === 0
          ? (
              <EmptyState
                title="No Curation evidence"
                description="This Curation stores no captured photo, audio or other evidence. Advanced is where a structured value can be added."
              />
            )
          : (
              <>
                <MediaList title="Images" kind="image" buckets={images} />
                <MediaList title="Audio" kind="audio" buckets={audio} />
                <OtherSources buckets={other} />
              </>
            )}
        <section className="ui-transcript" aria-label="Transcript">
          <p className="ui-transcript__availability">
            {hasTranscript ? 'A transcript is stored for this Curation.' : 'No transcript stored.'}
          </p>
          {transcriptNode !== null && <CurationFieldBlock node={transcriptNode} edit={edit} variant="transcript" />}
        </section>
      </div>
    </AdminSection>
  )
}
