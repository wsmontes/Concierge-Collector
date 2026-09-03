'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  createBrowserOperationsAdminClient,
  type BulkOperationHistoryRow,
  type OperationsAdminClient,
  type PublishJobHistoryRow,
} from '../../operations/admin-client'

const browserClient = createBrowserOperationsAdminClient()

const TERMINAL_PUBLISH = new Set([
  'completed',
  'failed',
  'cancelled',
  'stale',
  'conflicted',
  'authorization_revoked',
])

function progressLabel(progress: BulkOperationHistoryRow['progress']): string {
  const parts = [
    progress.processed > 0 ? `${progress.processed} applied` : null,
    progress.skipped > 0 ? `${progress.skipped} skipped` : null,
    progress.failed > 0 ? `${progress.failed} failed` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'queued'
}

function publicationStatus(job: PublishJobHistoryRow): string {
  return job.checkpoint ? `${job.status} · ${job.checkpoint}` : job.status
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function OperationsWorkspace({
  client = browserClient,
  pollMs = 5_000,
}: {
  client?: OperationsAdminClient
  pollMs?: number
}) {
  const [bulk, setBulk] = useState<BulkOperationHistoryRow[]>([])
  const [bulkCursor, setBulkCursor] = useState<string | null>(null)
  const [publishes, setPublishes] = useState<PublishJobHistoryRow[]>([])
  const [publishCursor, setPublishCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [bulkPage, publishPage] = await Promise.all([
        client.bulkOperations(),
        client.publishJobs(),
      ])
      setBulk(bulkPage.items)
      setBulkCursor(bulkPage.nextCursor)
      setPublishes(publishPage.items)
      setPublishCursor(publishPage.nextCursor)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'operations_unavailable')
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const hasLiveWork = bulk.some((operation) => operation.status === 'active') ||
      publishes.some((job) => !TERMINAL_PUBLISH.has(job.status))
    if (!hasLiveWork) return
    const timer = window.setInterval(() => { void reload() }, pollMs)
    return () => window.clearInterval(timer)
  }, [bulk, publishes, pollMs, reload])

  async function loadMoreBulk() {
    if (!bulkCursor) return
    try {
      const page = await client.bulkOperations(bulkCursor)
      setBulk((current) => [...current, ...page.items])
      setBulkCursor(page.nextCursor)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'operations_unavailable')
    }
  }

  async function loadMorePublishes() {
    if (!publishCursor) return
    try {
      const page = await client.publishJobs(publishCursor)
      setPublishes((current) => [...current, ...page.items])
      setPublishCursor(page.nextCursor)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'operations_unavailable')
    }
  }

  async function cancel(operation: BulkOperationHistoryRow) {
    if (operation.status !== 'active' || !operation.cancellable || cancelling) return
    setCancelling(operation.id)
    try {
      await client.cancelOperation(operation.id)
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'cancel_failed')
    } finally {
      setCancelling(null)
    }
  }

  return (
    <main className="operations-workspace">
      <header className="operations-workspace__header">
        <div>
          <p className="collection-views__eyebrow">Operations</p>
          <h1>Operations</h1>
          <p>Current and recent bulk draft work plus Collection publication jobs.</p>
        </div>
        <button type="button" onClick={() => void reload()}>Refresh</button>
      </header>

      {error && <p role="alert">Unable to refresh Operations: {error}</p>}
      {loading && <p role="status">Loading Operations…</p>}

      <section aria-labelledby="bulk-operations-title">
        <h2 id="bulk-operations-title">Bulk operations</h2>
        {!loading && bulk.length === 0 ? <p>No bulk operations yet.</p> : (
          <ul className="operations-workspace__list">
            {bulk.map((operation) => {
              const { active, completed, failed } = operation.parentSummary
              return (
                <li className="operations-workspace__card" key={operation.id}>
                  <div className="operations-workspace__card-header">
                    <div>
                      <strong>{operation.action === 'add' ? 'Add to draft' : 'Remove from draft'}</strong>
                      <span className={`operations-workspace__status operations-workspace__status--${operation.status}`}>{operation.status}</span>
                    </div>
                    <time dateTime={operation.updatedAt}>{formatTime(operation.updatedAt)}</time>
                  </div>
                  <p>{active} pending, {completed} done, {failed} failed</p>
                  <p>{progressLabel(operation.progress)}</p>
                  <div className="operations-workspace__collections" aria-label="Affected Collections">
                    {operation.collections.map((collection) => (
                      <a href={`/admin/collections/${encodeURIComponent(collection.id)}`} key={collection.id}>{collection.title}</a>
                    ))}
                  </div>
                  {operation.status === 'active' && operation.cancellable && (
                    <button
                      type="button"
                      aria-label="Cancel operation"
                      disabled={cancelling === operation.id}
                      onClick={() => void cancel(operation)}
                    >
                      {cancelling === operation.id ? 'Cancelling…' : 'Cancel remaining work'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {bulkCursor && <button type="button" onClick={() => void loadMoreBulk()}>Load more bulk operations</button>}
      </section>

      <section aria-labelledby="publish-operations-title">
        <h2 id="publish-operations-title">Publications</h2>
        {!loading && publishes.length === 0 ? <p>No publication jobs yet.</p> : (
          <ul className="operations-workspace__list">
            {publishes.map((job) => (
              <li className="operations-workspace__card" key={job.id}>
                <div className="operations-workspace__card-header">
                  <div>
                    <a href={`/admin/collections/${encodeURIComponent(job.collection.id)}`}>{job.collection.title}</a>
                    <strong>Version {job.targetVersion}</strong>
                  </div>
                  <time dateTime={job.updatedAt}>{formatTime(job.updatedAt)}</time>
                </div>
                <p>{publicationStatus(job)}</p>
                <p>
                  {job.selectedCount === null ? 'Selection count pending' : `${job.selectedCount.toLocaleString('en-US')} selected`}
                  {job.confirmedUnavailableCount > 0 ? ` · ${job.confirmedUnavailableCount} unavailable confirmed` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
        {publishCursor && <button type="button" onClick={() => void loadMorePublishes()}>Load more publications</button>}
      </section>
    </main>
  )
}