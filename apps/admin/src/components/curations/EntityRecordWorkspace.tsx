'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ContentRecordError, createContentRecordClient, type ContentRecord, type ContentRecordClient } from '../../curations/record-client'
import { ContentFieldInspector } from '../content/ContentFieldInspector'
import { ContentRecordHeader } from '../content/ContentRecordHeader'
import { CurationSection } from './CurationSection'

const browserClient = createContentRecordClient()

function humanError(error: unknown): string {
  if (error instanceof ContentRecordError) {
    if (error.status === 401) return 'Your Admin session has expired.'
    if (error.status === 403) return 'Admin access is required.'
    if (error.status === 404) return 'Entity not found.'
    return error.code
  }
  return error instanceof Error ? error.message : 'request_failed'
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * The canonical screen for one Entity.
 *
 * Entities answer "what is this thing", so the page leads with canonical
 * identity and then exposes the whole stored document — `data` and `metadata`
 * are flexible structures whose shape varies per source, and a field the Admin
 * has no component for still has to be readable.
 */
export function EntityRecordWorkspace({
  entityId,
  client = browserClient,
}: {
  entityId: string
  client?: ContentRecordClient
}) {
  const [loaded, setLoaded] = useState<ContentRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void client.entity(entityId).then(
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
  }, [client, entityId])

  if (loading) return <p role="status">Loading Entity…</p>
  if (error || !loaded) {
    return (
      <main className="content-record">
        <div role="alert">
          <p>{error ?? 'Entity not found.'}</p>
          <Link href="/admin/curations">Back to Curations</Link>
        </div>
      </main>
    )
  }

  const record = loaded.record
  const name = text(record.name) ?? text(record.entity_id) ?? 'Entity'

  return (
    <main className="content-record">
      <ContentRecordHeader
        badges={[
          { label: text(record.status) ?? 'unknown', tone: record.status === 'active' ? 'positive' : 'neutral' },
          ...(text(record.type) ? [{ label: text(record.type) as string, tone: 'neutral' }] : []),
        ]}
        subtitle={text(record.entity_id) ?? undefined}
        title={name}
      />

      <CurationSection id="canonical-identity" title="Canonical identity">
        <dl className="content-record__meta">
          <dt>Name</dt>
          <dd>{text(record.name) ?? '—'}</dd>
          <dt>Type</dt>
          <dd>{text(record.type) ?? '—'}</dd>
          <dt>Status</dt>
          <dd>{text(record.status) ?? '—'}</dd>
          <dt>External ID</dt>
          <dd>{text(record.externalId) ?? '—'}</dd>
          <dt>Version</dt>
          <dd>{typeof record.version === 'number' ? record.version : '—'}</dd>
        </dl>
      </CurationSection>

      <CurationSection id="all-fields" title="All fields">
        <p className="content-record__hint">
          Every stored field, including the flexible <code>data</code> and <code>metadata</code> structures.
        </p>
        <ContentFieldInspector kind="entity" record={record} title="All fields" />
      </CurationSection>
    </main>
  )
}
