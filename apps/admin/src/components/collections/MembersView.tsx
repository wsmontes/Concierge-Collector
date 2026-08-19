export interface MemberRow { curationId: string; available?: boolean; reasonCode?: string }

export function MembersView({ items }: { items: readonly MemberRow[] }) {
  return <ul aria-label="Collection members">{items.map((item) => <li key={item.curationId}>
    <code>{item.curationId}</code>{item.available === false ? ` · unavailable: ${item.reasonCode ?? 'unknown'}` : ''}
  </li>)}</ul>
}
