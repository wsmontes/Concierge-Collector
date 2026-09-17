'use client'

import { Button } from '@payloadcms/ui'
import Link from 'next/link'
import { useState } from 'react'
import type { LoadCurationRecord } from '../../content/record-types'
import type { AdminCurationRow } from '../../explorer/types'
import { CurationPreviewDrawer } from '../curations/CurationPreviewDrawer'
import { loadCurationRecordFromBff } from '../curations/curation-record-client'
import { AdminSection } from '../ui/AdminPage'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
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
  const addCurationsHref = collectionId ? `/admin/curations?collection=${encodeURIComponent(collectionId)}` : null

  return (
    <AdminSection
      description="Membership of the published version. Each row is the Curation as the catalog stores it; the ids stay behind the disclosure."
      title="Members"
    >
      <div className="collection-members">
        {items.length === 0 ? (
          <EmptyState
            action={addCurationsHref
              ? <Link className="collections-link-button" href={addCurationsHref}>Add Curations</Link>
              : undefined}
            description="Nothing is published into this Collection yet. Add Curations to the draft and publish a version to fill it."
            title="No members loaded yet."
          />
        ) : (
          <ul aria-label="Collection members" className="collection-members__list">
            {items.map((item) => {
              const summary = item.summary
              return (
                <li className="collection-members__row" key={item.curationId}>
                  <Card className="collection-members__card">
                    <CurationIdentity curationId={item.curationId} summary={summary} />
                    <div className="collection-members__facts ui-chip-group">
                      {summary && <StatusPill status={summary.status} />}
                      <p className="collection-members__updated ui-table__secondary">
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
                        <Button buttonStyle="secondary" margin={false} onClick={() => setPreview(summary)} size="small" type="button">
                          Preview
                        </Button>
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
                  </Card>
                </li>
              )
            })}
          </ul>
        )}

        {hasMore && onLoadMore && (
          <div className="collection-view__more">
            <Button buttonStyle="secondary" disabled={loading} margin={false} onClick={onLoadMore} type="button">
              {loading ? 'Loading more…' : 'Load more members'}
            </Button>
          </div>
        )}

        {preview && (
          // The drawer belongs to the Curations list (§12) and is reused as-is, so
          // the Collection context is added around it: the way back to the
          // Collection travels with the preview instead of replacing the shared
          // component's own actions.
          <div>
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
    </AdminSection>
  )
}
