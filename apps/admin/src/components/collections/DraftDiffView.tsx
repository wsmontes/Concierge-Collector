export interface DraftDiffRow { curationId: string; desiredState: 'add' | 'remove'; operationId: string }

export interface DraftDiffViewProps {
  items: readonly DraftDiffRow[]
  hasMore?: boolean
  loading?: boolean
  onLoadMore?: () => void
}

export function DraftDiffView({ items, hasMore = false, loading = false, onLoadMore }: DraftDiffViewProps) {
  return <div>
    <ul aria-label="Draft changes">{items.map((item) => <li key={item.curationId}>
      <strong>{item.desiredState === 'add' ? 'Add' : 'Remove'}</strong> <code>{item.curationId}</code>
    </li>)}</ul>
    {hasMore && onLoadMore && <button type="button" disabled={loading} onClick={onLoadMore}>
      {loading ? 'Loading…' : 'Load more draft changes'}
    </button>}
  </div>
}
