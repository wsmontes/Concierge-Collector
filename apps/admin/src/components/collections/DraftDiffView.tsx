export interface DraftDiffRow { curationId: string; desiredState: 'add' | 'remove'; operationId: string }

export function DraftDiffView({ items }: { items: readonly DraftDiffRow[] }) {
  return <ul aria-label="Draft changes">{items.map((item) => <li key={item.curationId}>
    <strong>{item.desiredState === 'add' ? 'Add' : 'Remove'}</strong> <code>{item.curationId}</code>
  </li>)}</ul>
}
