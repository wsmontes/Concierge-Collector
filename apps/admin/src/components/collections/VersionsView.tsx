export interface VersionRow { version: number; selectedCount: number; membershipHash: string; publishedAt?: string }

export interface VersionsViewProps {
  items: readonly VersionRow[]
  currentPublishedVersion?: number | null
  hasMore?: boolean
  loading?: boolean
  onLoadMore?: () => void
  onRestoreAsDraft?: (version: number) => void
}

export function VersionsView({
  items,
  currentPublishedVersion,
  hasMore = false,
  loading = false,
  onLoadMore,
  onRestoreAsDraft,
}: VersionsViewProps) {
  return <div>
    {currentPublishedVersion ? <p>Published version {currentPublishedVersion}</p> : <p>No published version yet.</p>}
    <ul aria-label="Published versions">{items.map((item) => <li key={item.version}>
      <strong>Version {item.version}</strong> · {item.selectedCount.toLocaleString('en-US')} selected · <code>{item.membershipHash.slice(0, 12)}</code>
      {onRestoreAsDraft && currentPublishedVersion && item.version !== currentPublishedVersion && (
        <button type="button" onClick={() => onRestoreAsDraft(item.version)}>
          Restore version {item.version} as draft
        </button>
      )}
    </li>)}</ul>
    {hasMore && onLoadMore && <button type="button" disabled={loading} onClick={onLoadMore}>
      {loading ? 'Loading…' : 'Load more versions'}
    </button>}
  </div>
}
