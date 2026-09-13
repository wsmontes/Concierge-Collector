'use client'

import { Button } from '@payloadcms/ui'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  createBrowserOperationsAdminClient,
  type BulkOperationHistoryRow,
  type OperationsAdminClient,
  type PublishJobHistoryRow,
} from '../../operations/admin-client'
import { AdminPage, AdminSection } from '../ui/AdminPage'
import { EmptyState } from '../ui/EmptyState'
import { InlineNotice } from '../ui/InlineNotice'
import { StatusPill } from '../ui/StatusPill'

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
    let active = true
    void (async () => {
      try {
        const [bulkPage, publishPage] = await Promise.all([
          client.bulkOperations(),
          client.publishJobs(),
        ])
        if (!active) return
        setBulk(bulkPage.items)
        setBulkCursor(bulkPage.nextCursor)
        setPublishes(publishPage.items)
        setPublishCursor(publishPage.nextCursor)
        setError(null)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'operations_unavailable')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [client])

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
    <AdminPage
      className="operations-workspace"
      eyebrow="Operations"
      title="Operations"
      description="Current and recent bulk draft work plus Collection publication jobs."
      actions={(
        <Button buttonStyle="secondary" margin={false} onClick={() => void reload()} type="button">
          Refresh
        </Button>
      )}
    >
      {error && <InlineNotice tone="error"><p>Unable to refresh Operations: {error}</p></InlineNotice>}
      {loading && <p role="status">Loading Operations…</p>}

      <AdminSection
        title="Bulk operations"
        description="Draft membership changes executed across one or more Collections."
        action={bulkCursor ? (
          <Button buttonStyle="secondary" margin={false} onClick={() => void loadMoreBulk()} size="small" type="button">
            Load more
          </Button>
        ) : undefined}
      >
        {!loading && bulk.length === 0 ? (
          <EmptyState title="No bulk operations yet" description="Bulk work from the Curation Explorer will appear here." />
        ) : (
          <ul className="operations-workspace__list">
            {bulk.map((operation) => {
              const { active, completed, failed } = operation.parentSummary
              return (
                <li className="operations-workspace__card" key={operation.id}>
                  <div className="operations-workspace__card-header">
                    <div className="operations-workspace__identity">
                      <strong>{operation.action === 'add' ? 'Add to draft' : 'Remove from draft'}</strong>
                      <StatusPill status={operation.status} label={operation.status} />
                    </div>
                    <time dateTime={operation.updatedAt}>{formatTime(operation.updatedAt)}</time>
                  </div>
                  <div className="operations-workspace__metrics">
                    <span>{active} pending, {completed} done, {failed} failed</span>
                    <span>{progressLabel(operation.progress)}</span>
                  </div>
                  <div className="operations-workspace__collections" aria-label="Affected Collections">
                    {operation.collections.map((collection) => (
                      <Link href={`/admin/collections/collections/${encodeURIComponent(collection.id)}`} key={collection.id}>{collection.title}</Link>
                    ))}
                  </div>
                  {operation.status === 'active' && operation.cancellable && (
                    <div className="operations-workspace__card-actions">
                      <Button
                        aria-label="Cancel operation"
                        buttonStyle="error"
                        disabled={cancelling === operation.id}
                        margin={false}
                        onClick={() => void cancel(operation)}
                        size="small"
                        type="button"
                      >
                        {cancelling === operation.id ? 'Cancelling…' : 'Cancel remaining work'}
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </AdminSection>

      <AdminSection
        title="Publications"
        description="Version promotion jobs and their latest checkpoints."
        action={publishCursor ? (
          <Button buttonStyle="secondary" margin={false} onClick={() => void loadMorePublishes()} size="small" type="button">
            Load more
          </Button>
        ) : undefined}
      >
        {!loading && publishes.length === 0 ? (
          <EmptyState title="No publication jobs yet" description="Collection publish activity will appear here." />
        ) : (
          <ul className="operations-workspace__list">
            {publishes.map((job) => (
              <li className="operations-workspace__card" key={job.id}>
                <div className="operations-workspace__card-header">
                  <div className="operations-workspace__identity">
                    <Link href={`/admin/collections/collections/${encodeURIComponent(job.collection.id)}`}>{job.collection.title}</Link>
                    <strong>Version {job.targetVersion}</strong>
                    <StatusPill status={job.status} label={job.status} />
                  </div>
                  <time dateTime={job.updatedAt}>{formatTime(job.updatedAt)}</time>
                </div>
                {job.checkpoint && <p className="operations-workspace__checkpoint">{job.checkpoint}</p>}
                <p className="operations-workspace__summary">
                  {job.selectedCount === null ? 'Selection count pending' : `${job.selectedCount.toLocaleString('en-US')} selected`}
                  {job.confirmedUnavailableCount > 0 ? ` · ${job.confirmedUnavailableCount} unavailable confirmed` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </AdminPage>
  )
}
