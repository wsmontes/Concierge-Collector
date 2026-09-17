import { Button } from '@payloadcms/ui'
import { AdminSection } from '../ui/AdminPage'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'

export interface ActivityRow { eventType: string; actorId: string; createdAt: string }

export interface ActivityViewProps {
  items: readonly ActivityRow[]
  hasMore?: boolean
  loading?: boolean
  onLoadMore?: () => void
}

/**
 * The audit events of one Collection, newest first (§25).
 *
 * The event type stays as the stored slug (`collection.published`) instead of a
 * prettified label: this is the log the operations team greps when a command is
 * questioned, and a humanized name would no longer match the stored event.
 * The timestamp reads relatively and keeps the absolute value in its `title`.
 */
export function ActivityView({ items, hasMore = false, loading = false, onLoadMore }: ActivityViewProps) {
  return (
    <AdminSection
      description="Commands and publications recorded for this Collection, newest first."
      title="Activity"
    >
      <div className="collection-activity-view">
        <ul aria-busy={loading || undefined} aria-label="Collection activity" className="collection-activity">
          {items.map((item, index) => (
            <li className="collection-activity__row" key={`${item.createdAt}-${index}`}>
              <code className="collection-activity__event">{item.eventType}</code>
              <span className="collection-activity__actor">{item.actorId}</span>
              <time
                className="collection-activity__when"
                dateTime={item.createdAt}
                title={formatAbsoluteDate(item.createdAt) ?? undefined}
              >
                {formatRelativeDate(item.createdAt)}
              </time>
            </li>
          ))}
          {items.length === 0 && (
            <li className="collection-activity__empty">No activity recorded yet.</li>
          )}
        </ul>
        {hasMore && onLoadMore && (
          <div className="collection-view__more">
            <Button buttonStyle="secondary" disabled={loading} margin={false} onClick={onLoadMore} size="small" type="button">
              {loading ? 'Loading more…' : 'Load more activity'}
            </Button>
          </div>
        )}
      </div>
    </AdminSection>
  )
}
