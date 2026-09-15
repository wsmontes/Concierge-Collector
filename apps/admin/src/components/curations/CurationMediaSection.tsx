'use client'

import type { ReactNode } from 'react'
import type { FieldNode } from '../../content/field-types'
import { humanizeFieldName } from '../../content/field-types'
import { AdminSection } from '../ui/AdminPage'
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
    <dl className="curation-source__meta">
      {rows.map((row, position) => (
        <div key={position} className="curation-source__meta-row">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
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
    <li className="curation-source__entry" data-kind={kind}>
      <p className="curation-source__entry-title">{view.filename ?? `${KIND_LABEL[kind]} ${index + 1}`}</p>
      {view.url === null
        ? <p className="curation-source__note">No stored URL for this item; its provenance is listed instead.</p>
        : (
            <p className="curation-source__links">
              <a href={view.url} rel="noreferrer" target="_blank">Open original</a>
              <a href={view.url} download>Download original</a>
            </p>
          )}
      <ul className="curation-source__facts">
        {view.durationSeconds !== null && <li>Duration {durationLabel(view.durationSeconds)}</li>}
        {view.status !== null && <li>Processing: {view.status}</li>}
        {kind === 'audio' && <li>{view.transcript === null ? 'No transcription stored' : 'Transcription available'}</li>}
      </ul>
      <MetadataList rows={view.rows} />
      {view.transcript !== null && (
        <details className="curation-source__transcription">
          <summary>Stored transcription</summary>
          <pre>{view.transcript}</pre>
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
    <section className="curation-source" aria-label={title}>
      <h3 className="curation-source__title">{title}</h3>
      <p className="curation-source__count">{entries.length} stored</p>
      {entries.length === 0
        ? <p className="curation-source__empty">No {title.toLocaleLowerCase()} stored.</p>
        : (
            <ol className="curation-source__entries">
              {entries.map((entry, index) => <SourceEntry key={index} entry={entry} index={index} kind={kind} />)}
            </ol>
          )}
    </section>
  )
}

/** Sources the page has no media vocabulary for still surface, under their own key. */
function OtherSources({ buckets }: { buckets: readonly SourceBucket[] }): ReactNode {
  return (
    <section className="curation-source" aria-label="Other sources">
      <h3 className="curation-source__title">Other sources</h3>
      {buckets.length === 0
        ? <p className="curation-source__empty">No other sources stored.</p>
        : buckets.map((bucket) => (
            <div className="curation-source__bucket" key={bucket.key}>
              <h4 className="curation-source__bucket-title">{humanizeFieldName(bucket.key)}</h4>
              <p className="curation-source__count">{bucket.entries.length} stored</p>
              <ol className="curation-source__entries">
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

  return (
    <AdminSection title="Media & sources" description="What this Curation was built from, exactly as the record stores it.">
      <div className="curation-media">
        {buckets.length === 0 && <p className="curation-media__empty">No sources recorded.</p>}
        <MediaList title="Images" kind="image" buckets={images} />
        <MediaList title="Audio" kind="audio" buckets={audio} />
        <OtherSources buckets={other} />
        <section className="curation-transcript" aria-label="Transcript">
          <p className="curation-transcript__availability">
            {hasTranscript ? 'A transcript is stored for this Curation.' : 'No transcript stored.'}
          </p>
          {transcriptNode !== null && <CurationFieldBlock node={transcriptNode} edit={edit} variant="transcript" />}
        </section>
      </div>
    </AdminSection>
  )
}
