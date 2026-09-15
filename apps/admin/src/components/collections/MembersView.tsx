'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { LoadCurationRecord } from '../../content/record-types'
import type { AdminCurationRow } from '../../explorer/types'
import { CurationPreviewDrawer } from '../curations/CurationPreviewDrawer'
import { loadCurationRecordFromBff } from '../curations/curation-record-client'
import { StatusPill } from '../ui/StatusPill'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'
import { CurationIdentity } from './CurationIdentity'
import { TechnicalDetails } from './TechnicalDetails'

/** One Collection member: the identity of its Curation, or `null` when the catalog dropped it. */
export interface MemberRow {
  curationId: string
  summary: AdminCurationRow | null
}

export interface MembersViewProps {
  items: readonly MemberRow[]
  /** The Collection these members belong to; the preview uses it as its way back. */
  collectionId?: string
  hasMore?: boolean
  loading?: boolean
  loadRecord?: LoadCurationRecord
  onLoadMore?: () => void
}

/**
 * The members of one Collection, as editorial rows (§24).
 *
 * A row is a restaurant, a curator, a place, its concepts and its status; the
 * stored ids stay inside a collapsed disclosure, and a member whose catalog row
 * is gone keeps its id with an explicit note rather than an empty cell. Preview
 * opens the shared Curation drawer (§12) without dropping the Collection.
 */
export function MembersView({
  items,
  collectionId,
  hasMore = false,
  loading = false,
  loadRecord = loadCurationRecordFromBff,
  onLoadMore,
}: MembersViewProps) {
  const [preview, setPreview] = useState<AdminCurationRow | null>(null)
  const collectionHref = collectionId ? `/admin/collections/collections/${encodeURIComponent(collectionId)}` : null

  return (
    <div className="collection-members">
      <ul aria-label="Collection members" className="collection-members__list">
        {items.map((item) => {
          const summary = item.summary
          return (
            <li className="collection-members__row" key={item.curationId}>
              <CurationIdentity curationId={item.curationId} summary={summary} />
              <div className="collection-members__facts">
                {summary && <StatusPill status={summary.status} />}
                <p className="collection-members__updated">
                  Updated{' '}
                  {summary?.updated_at
                    ? (
                      <time
                        dateTime={summary.updated_at}
                        title={formatAbsoluteDate(summary.updated_at) ?? undefined}
                      >
                        {formatRelativeDate(summary.updated_at)}
                      </time>
                    )
                    : <span className="collection-members__unknown">unknown</span>}
                </p>
              </div>
              <div className="collection-members__actions">
                {summary && (
                  <button type="button" onClick={() => setPreview(summary)}>Preview</button>
                )}
                <Link
                  className="collection-members__open"
                  href={`/admin/curations/${encodeURIComponent(item.curationId)}`}
                >
                  Open
                </Link>
              </div>
              {summary && (
                <TechnicalDetails details={[
                  { term: 'Curation id', value: item.curationId },
                  ...(typeof summary.version === 'number'
                    ? [{ term: 'Version', value: String(summary.version) }]
                    : []),
                ]} />
              )}
            </li>
          )
        })}
      </ul>
      {items.length === 0 && <p className="collection-members__empty">No members loaded yet.</p>}
      {hasMore && onLoadMore && (
        <button type="button" disabled={loading} onClick={onLoadMore}>
          {loading ? 'Loading…' : 'Load more members'}
        </button>
      )}
      {preview && (
        // The drawer belongs to the Curations list (§12) and is reused as-is, so
        // the Collection context is added around it: the way back to the
        // Collection travels with the preview instead of replacing the shared
        // component's own actions.
        <div className="collection-member-preview">
          <CurationPreviewDrawer
            key={preview.curation_id}
            loadRecord={loadRecord}
            onClose={() => setPreview(null)}
            row={preview}
          />
          {collectionHref && (
            <Link className="collection-member-preview__back" href={collectionHref}>Back to Collection</Link>
          )}
        </div>
      )}
    </div>
  )
}
