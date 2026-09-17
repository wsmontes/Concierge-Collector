'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getFieldValue } from '../../content/field-path'
import type { CurationCollectionLink, CurationRecordResponse, LoadCurationRecord } from '../../content/record-types'
import { isRecord } from '../../content/value-guards'
import type { AdminCurationRow } from '../../explorer/types'
import { AdminSection } from '../ui/AdminPage'
import { Chip } from '../ui/Chip'
import { Drawer } from '../ui/Drawer'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { FactList } from '../ui/Card'
import { SkeletonRows } from '../ui/Skeleton'
import { StatusPill } from '../ui/StatusPill'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'

export interface CurationPreviewDrawerProps {
  row: AdminCurationRow
  loadRecord: LoadCurationRecord
  onClose: () => void
  /** Editor URL of the full record; no `Edit` control renders without it. */
  editHref?: string | null
}

interface ConceptGroup {
  category: string
  values: string[]
}

/** Everything the drawer shows, read from the stored record — never invented. */
interface CurationPreview {
  curationId: string
  curatorType: string | null
  status: string | null
  entityId: string | null
  entityName: string | null
  entityPlace: string | null
  curator: string | null
  summary: string | null
  concepts: ConceptGroup[]
  audio: number | null
  images: number | null
  transcript: 'Available' | 'Not available' | null
  collections: CurationCollectionLink[]
  updatedAt: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function listLength(container: unknown, key: string): number | null {
  if (!isRecord(container)) return null
  const value = container[key]
  return Array.isArray(value) ? value.length : null
}

function conceptGroups(value: unknown): ConceptGroup[] {
  if (!isRecord(value)) return []
  return Object.entries(value)
    .map(([category, raw]) => ({ category, values: stringList(raw) }))
    .filter((group) => group.values.length > 0)
}

function previewOf(response: CurationRecordResponse, row: AdminCurationRow): CurationPreview {
  const { record, collections } = response
  const sources = getFieldValue(record, 'sources')
  const transcript = text(getFieldValue(record, 'transcript')) ?? text(getFieldValue(record, 'sources.audio[0].transcript'))
  const notes = getFieldValue(record, 'notes')
  const place = [
    text(getFieldValue(record, 'city')) ?? row.city,
    text(getFieldValue(record, 'type')) ?? row.entity_type,
  ].filter((part): part is string => part !== null)
  return {
    curationId: text(getFieldValue(record, 'curation_id')) ?? row.curation_id,
    curatorType: text(getFieldValue(record, 'curator_type')),
    status: text(getFieldValue(record, 'status')) ?? row.status,
    entityId: text(getFieldValue(record, 'entity_id')),
    entityName: text(getFieldValue(record, 'restaurant_name')) ?? row.restaurant_name,
    entityPlace: place.length > 0 ? place.join(' · ') : null,
    curator: text(getFieldValue(record, 'curator.name')) ?? row.curator_name ?? row.curator_id,
    summary: text(getFieldValue(record, 'notes.public')) ?? text(notes),
    concepts: conceptGroups(getFieldValue(record, 'categories')),
    audio: listLength(sources, 'audio'),
    images: listLength(sources, 'image'),
    transcript: transcript ? 'Available' : isRecord(sources) ? 'Not available' : null,
    collections,
    updatedAt: text(getFieldValue(record, 'updatedAt')) ?? row.updated_at,
  }
}

/**
 * Side preview of one Curation: the list keeps its context, the operator sees
 * enough to identify the record, and the full page is one deliberate click
 * away.
 *
 * The overlay is the kit's `Drawer`, so the shell owns focus trap, `Esc` and
 * the backdrop — the three gestures the hand-rolled version here never had.
 * The owner remounts this drawer per Curation (`key`), which is what returns
 * the loading state to a fresh record.
 */
export function CurationPreviewDrawer({ row, loadRecord, onClose, editHref = null }: CurationPreviewDrawerProps) {
  const [attempt, setAttempt] = useState(0)
  /**
   * O resultado do read vive amarrado à CHAVE da requisição que o produziu. Com
   * isso "carregando" não é estado escrito dentro do efeito (que é o que a regra
   * `set-state-in-effect` proíbe): é a ausência de um resultado para a chave
   * atual — pedir de novo pelo botão do erro muda a chave e o esqueleto volta
   * sozinho.
   */
  const requestKey = `${attempt}:${row.curation_id}`
  const [result, setResult] = useState<{ key: string; preview?: CurationPreview; failed?: boolean } | null>(null)

  useEffect(() => {
    let active = true
    void loadRecord(row.curation_id).then(
      (response) => {
        if (active) setResult({ key: requestKey, preview: previewOf(response, row) })
      },
      () => {
        if (active) setResult({ key: requestKey, failed: true })
      },
    )
    return () => { active = false }
  }, [loadRecord, requestKey, row])

  const settled = result !== null && result.key === requestKey ? result : null
  const preview = settled?.preview ?? null
  const loading = settled === null
  const failed = settled?.failed === true

  return (
    <Drawer open onClose={onClose} title={preview?.entityName ?? row.restaurant_name ?? row.curation_id}>
      {loading && (
        <div>
          <span className="ui-visually-hidden" role="status">Loading Curation…</span>
          <SkeletonRows rows={5} />
        </div>
      )}

      {failed && (
        <ErrorState
          title="Unable to load this Curation."
          description="The record could not be read. Nothing was changed."
          onRetry={() => setAttempt((current) => current + 1)}
          retryLabel="Try again"
        />
      )}

      {preview !== null && (
        <div className="ui-preview">
          <div className="ui-preview__chips">
            <StatusPill status={preview.status ?? row.status} />
            {preview.curatorType !== null && (
              <Chip size="sm" tone="neutral">
                {`${preview.curatorType.charAt(0).toLocaleUpperCase()}${preview.curatorType.slice(1)} Curation`}
              </Chip>
            )}
          </div>

          <AdminSection title="Entity">
            {preview.entityId ? (
              <>
                <p className="ui-preview__value">{preview.entityName ?? '—'}</p>
                <p className="ui-preview__muted">{preview.entityPlace ?? '—'}</p>
                <Link href={`/admin/entities/${encodeURIComponent(preview.entityId)}`}>View Entity →</Link>
              </>
            ) : (
              <>
                <p className="ui-preview__label">Working name</p>
                <p className="ui-preview__value">{preview.entityName ?? '—'}</p>
                <Link href={`/admin/entities?q=${encodeURIComponent(preview.entityName ?? row.curation_id)}`}>
                  Find and link Entity
                </Link>
              </>
            )}
          </AdminSection>

          <AdminSection title="Curator">
            <p className="ui-preview__value">{preview.curator ?? '—'}</p>
          </AdminSection>

          <AdminSection title="Public recommendation">
            {preview.summary
              ? <p className="ui-preview__summary">{preview.summary}</p>
              : <p className="ui-preview__muted">No public recommendation recorded.</p>}
          </AdminSection>

          <AdminSection title="Concepts">
            {preview.concepts.length === 0
              ? (
                  <EmptyState
                    title="No concepts recorded"
                    description="This Curation carries no category/value pairs yet."
                  />
                )
              : <FactList facts={preview.concepts.map((group) => ({ label: group.category, value: group.values.join(' · ') }))} />}
          </AdminSection>

          <AdminSection title="Curation evidence">
            <FactList
              facts={[
                { label: 'Captured audio', value: preview.audio ?? '—' },
                { label: 'Captured images', value: preview.images ?? '—' },
                { label: 'Transcript', value: preview.transcript ?? '—' },
              ]}
            />
          </AdminSection>

          <AdminSection title="Collections">
            {preview.collections.length === 0
              ? (
                  <EmptyState
                    title="Not in any Collection"
                    description="This Curation reaches no application yet."
                  />
                )
              : (
                  <ul className="ui-preview__collections">
                    {preview.collections.map((link) => (
                      <li className="ui-preview__collection" key={link.collection_id}>
                        <Link href={`/admin/collections/collections/${encodeURIComponent(link.collection_id)}`}>
                          {link.title}
                        </Link>
                        {typeof link.current_published_version === 'number' && (
                          <Chip size="sm" tone="success">{`v${link.current_published_version}`}</Chip>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
          </AdminSection>

          <AdminSection title="Updated">
            {preview.updatedAt
              ? (
                  <p className="ui-preview__value">
                    <time dateTime={preview.updatedAt} title={formatAbsoluteDate(preview.updatedAt) ?? undefined}>
                      {formatRelativeDate(preview.updatedAt)}
                    </time>
                  </p>
                )
              : <p className="ui-preview__muted">—</p>}
          </AdminSection>

          <div className="ui-preview__actions">
            <Link className="ui-preview__primary" href={`/admin/curations/${encodeURIComponent(preview.curationId)}`}>
              Open full Curation
            </Link>
            {editHref && <Link className="ui-preview__secondary" href={editHref}>Edit</Link>}
          </div>
        </div>
      )}
    </Drawer>
  )
}
