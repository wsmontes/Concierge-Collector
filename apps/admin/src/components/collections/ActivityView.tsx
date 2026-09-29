export interface ActivityRow { eventType: string; actorId: string; createdAt: string }

export interface ActivityViewProps {
  items: readonly ActivityRow[]
  hasMore?: boolean
  loading?: boolean
  onLoadMore?: () => void
}

export function ActivityView({ items, hasMore = false, loading = false, onLoadMore }: ActivityViewProps) {
  return <div>
    <ul aria-label="Collection activity">{items.map((item, index) => <li key={`${item.createdAt}-${index}`}>
      {item.eventType} · {item.actorId} · {new Date(item.createdAt).toLocaleString()}
    </li>)}</ul>
    {hasMore && onLoadMore && <button type="button" disabled={loading} onClick={onLoadMore}>
      {loading ? 'Loading…' : 'Load more activity'}
    </button>}
  </div>
}
