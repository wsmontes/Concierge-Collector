export interface ActivityRow { eventType: string; actorId: string; createdAt: string }

export function ActivityView({ items }: { items: readonly ActivityRow[] }) {
  return <ul aria-label="Collection activity">{items.map((item, index) => <li key={`${item.createdAt}-${index}`}>
    {item.eventType} · {item.actorId} · {new Date(item.createdAt).toLocaleString()}
  </li>)}</ul>
}
