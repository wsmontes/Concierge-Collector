export interface VersionRow { version: number; selectedCount: number; membershipHash: string; publishedAt?: string }

export function VersionsView({ items }: { items: readonly VersionRow[] }) {
  return <ul aria-label="Published versions">{items.map((item) => <li key={item.version}>
    <strong>Version {item.version}</strong> · {item.selectedCount.toLocaleString('en-US')} selected · <code>{item.membershipHash.slice(0, 12)}</code>
  </li>)}</ul>
}
