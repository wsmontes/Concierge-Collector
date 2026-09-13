'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ContentRecordError, createContentRecordClient, type ContentRecord, type ContentRecordClient } from '../../curations/record-client'
import { ContentFieldInspector } from '../content/ContentFieldInspector'
import { ContentRecordHeader } from '../content/ContentRecordHeader'
import { CurationConcepts } from './CurationConcepts'
import { CurationSources } from './CurationSources'
import { CurationSection } from './CurationSection'
import { CurationTextEditor } from './CurationTextEditor'
import { entityRecordPath } from './record-paths'

const browserClient = createContentRecordClient()

function humanError(error: unknown): string {
  if (error instanceof ContentRecordError) {
    if (error.status === 401) return 'Your Admin session has expired.'
    if (error.status === 403) return 'Admin access is required.'
    if (error.status === 404) return 'Curation not found.'
    return error.code
  }
  return error instanceof Error ? error.message : 'request_failed'
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function recordValue(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (current, segment) => (current && typeof current === 'object'
      ? (current as Record<string, unknown>)[segment]
      : undefined),
    record,
  )
}

function title(record: Record<string, unknown>): string {
  return text(record.restaurant_name) ?? text(record.curation_id) ?? 'Curation'
}

function version(record: Record<string, unknown>): number | null {
  return typeof record.version === 'number' ? record.version : null
}

/**
 * The canonical screen for one Curation.
 *
 * It is deliberately assembled from the sections an editor thinks in (about,
 * their own curation, concepts, media) plus the universal inspector that
 * guarantees every stored field stays reachable even when no section models it.
 */
export function CurationRecordWorkspace({
  curationId,
  client = browserClient,
}: {
  curationId: string
  client?: ContentRecordClient
}) {
  const [loaded, setLoaded] = useState<ContentRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void client.curation(curationId).then(
      (next) => {
        if (!active) return
        setLoaded(next)
        setError(null)
        setLoading(false)
      },
      (cause) => {
        if (!active) return
        setError(humanError(cause))
        setLoading(false)
      },
    )
    return () => { active = false }
  }, [client, curationId])

  if (loading) return <p role="status">Loading Curation…</p>
  if (error || !loaded) {
    return (
      <main className="content-record">
        <div role="alert">
          <p>{error ?? 'Curation not found.'}</p>
          <Link href="/admin/curations">Back to Curations</Link>
        </div>
      </main>
    )
  }

  const record = loaded.record
  const curator = recordValue(record, 'curator.name') ?? record.curator_id
  const entityId = text(record.entity_id)
  const notes = (record.notes ?? {}) as Record<string, unknown>
  const updated = text(record.updatedAt)
  const versionNumber = version(record)

  const badges = [
    { label: text(record.curator_type) === 'synthetic' ? 'Synthetic' : 'Human', tone: 'neutral' },
    { label: dataLabel(record.status), tone: record.status === 'active' ? 'positive' : 'neutral' },
  ]

  return (
    <main className="content-record">
      <ContentRecordHeader
        actions={<Link href="/admin/curations">Back to Curations</Link>}
        badges={badges}
        subtitle={[text(record.city), text(record.type), text(curator) ? `Curator: ${text(curator)}` : null]
          .filter((part): part is string => Boolean(part))
          .join(' · ') || undefined}
        title={title(record)}
      />

      <CurationSection id="about" title="About">
        {entityId
          ? (
            <>
              <p className="content-record__muted">
                Entity <Link href={entityRecordPath(entityId)}>{entityId}</Link>
              </p>
              <p className="content-record__hint">
                City and type come from the linked Entity; edit them there, not here.
              </p>
            </>
          )
          : <p className="content-record__hint">No Entity linked — the name above is a working name.</p>}
      </CurationSection>

      <CurationSection id="curation" title="Your curation">
        <CurationTextEditor
          client={client}
          curationId={curationId}
          field="notes.public"
          label="Public recommendation"
          onSaved={setLoaded}
          record={record}
          value={text(notes.public)}
        />
        <CurationTextEditor
          client={client}
          curationId={curationId}
          field="notes.private"
          label="Private note"
          onSaved={setLoaded}
          record={record}
          value={text(notes.private)}
        />
        <CurationTextEditor
          client={client}
          curationId={curationId}
          field="transcript"
          label="Transcript"
          onSaved={setLoaded}
          record={record}
          value={text(record.transcript)}
        />
      </CurationSection>

      <CurationSection id="concepts" title="Concepts">
        <CurationConcepts categories={record.categories} />
      </CurationSection>

      <CurationSection id="media" title="Media & sources">
        <CurationSources sources={record.sources} />
      </CurationSection>

      <CurationSection id="history" title="History">
        <dl className="content-record__meta">
          <dt>Updated</dt>
          <dd>{updated ?? '—'}</dd>
          <dt>Version</dt>
          <dd>{versionNumber ?? '—'}</dd>
          <dt>Created</dt>
          <dd>{text(record.createdAt) ?? '—'}</dd>
          <dt>Updated by</dt>
          <dd>{text(record.updatedBy) ?? '—'}</dd>
        </dl>
      </CurationSection>

      <CurationSection id="all-fields" title="All fields">
        <p className="content-record__hint">
          Every field stored on this Curation, including ones no section above models.
        </p>
        <ContentFieldInspector kind="curation" record={record} title="All fields" />
      </CurationSection>
    </main>
  )
}

function dataLabel(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : 'unknown'
}
