export interface MemberRow { curationId: string; available?: boolean; reasonCode?: string }

export interface MembersViewProps {
  items: readonly MemberRow[]
  hasMore?: boolean
  loading?: boolean
  onLoadMore?: () => void
}

export function MembersView({ items, hasMore = false, loading = false, onLoadMore }: MembersViewProps) {
  return <div>
    <ul aria-label="Collection members">{items.map((item) => <li key={item.curationId}>
      <code>{item.curationId}</code>{item.available === false ? ` · unavailable: ${item.reasonCode ?? 'unknown'}` : ''}
    </li>)}</ul>
    {hasMore && onLoadMore && <button type="button" disabled={loading} onClick={onLoadMore}>
      {loading ? 'Loading…' : 'Load more members'}
    </button>}
  </div>
}
