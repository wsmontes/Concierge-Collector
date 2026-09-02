export interface VersionRow { version: number; selectedCount: number; membershipHash: string; publishedAt?: string }

export interface VersionsViewProps {
  items: readonly VersionRow[]
  hasMore?: boolean
  loading?: boolean
  onLoadMore?: () => void
}

export function VersionsView({ items, hasMore = false, loading = false, onLoadMore }: VersionsViewProps) {
  return <div>
    <ul aria-label="Published versions">{items.map((item) => <li key={item.version}>
      <strong>Version {item.version}</strong> · {item.selectedCount.toLocaleString('en-US')} selected · <code>{item.membershipHash.slice(0, 12)}</code>
    </li>)}</ul>
    {hasMore && onLoadMore && <button type="button" disabled={loading} onClick={onLoadMore}>
      {loading ? 'Loading…' : 'Load more versions'}
    </button>}
  </div>
}
