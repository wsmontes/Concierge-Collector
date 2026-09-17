import { Button } from '@payloadcms/ui'
import { AdminSection } from '../ui/AdminPage'
import { Chip } from '../ui/Chip'
import { DataTable, type DataTableColumn } from '../ui/DataTable'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'

export interface VersionRow { version: number; selectedCount: number; membershipHash: string; publishedAt?: string }

export interface VersionsViewProps {
  items: readonly VersionRow[]
  currentPublishedVersion?: number | null
  hasMore?: boolean
  loading?: boolean
  onLoadMore?: () => void
  onRestoreAsDraft?: (version: number) => void
}

/**
 * Published versions of one Collection, as the whole page of the cursor read.
 *
 * The table is the kit `DataTable` — same caption semantics, keyboard row
 * movement and mobile stacking as every other list — and the only per-row action
 * is restoring a historical version as draft, which the published version itself
 * does not offer.
 */
export function VersionsView({
  items,
  currentPublishedVersion,
  hasMore = false,
  loading = false,
  onLoadMore,
  onRestoreAsDraft,
}: VersionsViewProps) {
  const published = currentPublishedVersion ?? null
  const columns: Array<DataTableColumn<VersionRow>> = [
    {
      key: 'version',
      header: 'Version',
      label: 'Version',
      width: 'minmax(8rem, 1fr)',
      cell: (row) => (
        <span className="ui-table__cell-stack">
          <span className="ui-table__primary">Version {row.version}</span>
          {row.publishedAt && (
            <span className="ui-table__secondary">
              <time dateTime={row.publishedAt} title={formatAbsoluteDate(row.publishedAt) ?? undefined}>
                {formatRelativeDate(row.publishedAt)}
              </time>
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'selected',
      header: 'Selected',
      label: 'Selected',
      align: 'end',
      cell: (row) => <span className="ui-table__num">{row.selectedCount.toLocaleString('en-US')}</span>,
    },
    {
      key: 'hash',
      header: 'Membership hash',
      label: 'Membership hash',
      width: 'minmax(9rem, 1fr)',
      cell: (row) => <code className="ui-table__mono" title={row.membershipHash}>{row.membershipHash.slice(0, 12)}</code>,
    },
    {
      key: 'state',
      header: 'State',
      label: 'State',
      cell: (row) => (
        <Chip size="sm" tone={row.version === published ? 'accent' : 'neutral'}>
          {row.version === published ? 'Published' : 'Historical'}
        </Chip>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      align: 'end',
      cell: (row) => (onRestoreAsDraft && published && row.version !== published
        ? (
          <Button
            buttonStyle="secondary"
            margin={false}
            onClick={() => onRestoreAsDraft(row.version)}
            size="small"
            type="button"
          >
            Restore version {row.version} as draft
          </Button>
        )
        : null),
    },
  ]

  return (
    <AdminSection
      description={currentPublishedVersion
        ? `Published version ${currentPublishedVersion}`
        : 'No published version yet.'}
      title="Versions"
    >
      <DataTable
        caption="Published versions"
        columns={columns}
        empty={<p className="collection-draft-diff__empty">No published versions yet.</p>}
        footer={(
          <>
            <span>{items.length.toLocaleString('en-US')} versions loaded</span>
            {hasMore && onLoadMore && (
              <Button buttonStyle="secondary" disabled={loading} margin={false} onClick={onLoadMore} size="small" type="button">
                {loading ? 'Loading more…' : 'Load more versions'}
              </Button>
            )}
          </>
        )}
        loading={loading}
        rowKey={(row) => String(row.version)}
        rows={[...items]}
        skeletonRows={3}
      />
    </AdminSection>
  )
}
