'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ActiveJobRow {
  id: string
  action: 'add' | 'remove'
  selectionId: string | null
  status: 'active' | 'completed' | 'failed'
  parentSummary: { active: number; completed: number; failed: number }
  progress: Record<string, number>
  cancellable: boolean
  createdAt: string
  updatedAt: string
}

export interface ActiveOperationsResponse {
  items: ActiveJobRow[]
  nextCursor: string | null
}

const MAX_BACKOFF_MS = 30_000

/**
 * Polls the active parent-operation list. The effect owns its AbortController
 * and timer; unmount aborts the in-flight request and clears the pending poll.
 * Transient failures back off instead of spinning.
 */
export function useActiveOperations({ pollMs = 2_000 }: { pollMs?: number } = {}) {
  const [jobs, setJobs] = useState<ActiveJobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    let timer: number | undefined
    let stopped = false
    let delay = pollMs
    let firstAttempt = true

    const poll = async () => {
      try {
        const url = new URL('/api/admin/v1/operations', window.location.origin)
        url.searchParams.set('actor', 'current')
        url.searchParams.set('active', 'true')
        const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal })
        if (!response.ok) throw new Error('unable_to_load_jobs')
        const data = await response.json() as ActiveOperationsResponse
        if (stopped) return
        setJobs(data.items)
        setError(null)
        delay = pollMs
      } catch {
        if (stopped || controller.signal.aborted) return
        setError('jobs_unavailable')
        delay = Math.min(delay * 2, MAX_BACKOFF_MS)
      } finally {
        if (firstAttempt && !stopped) {
          firstAttempt = false
          setLoading(false)
        }
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), delay)
    }

    void poll()
    return () => {
      stopped = true
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [pollMs, refreshKey])

  const refresh = useCallback(() => {
    setLoading(true)
    setRefreshKey((key) => key + 1)
  }, [])

  return { jobs, loading, error, refresh }
}

function progressLabel(progress: Record<string, number>): string {
  const processed = Number(progress.processed ?? 0)
  const skipped = Number(progress.skipped ?? 0)
  const failed = Number(progress.failed ?? 0)
  if (processed === 0 && skipped === 0 && failed === 0) return 'queued'
  return [processed > 0 ? `${processed} applied` : null, skipped > 0 ? `${skipped} skipped` : null, failed > 0 ? `${failed} failed` : null]
    .filter(Boolean)
    .join(', ')
}

async function cancelOperation(operationId: string): Promise<void> {
  const response = await fetch(`/api/admin/v1/operation-history/${operationId}/cancel`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-request-id': crypto.randomUUID() },
  })
  if (!response.ok) throw new Error('unable_to_cancel')
}

function JobRow({ job, onCancelled }: { job: ActiveJobRow; onCancelled: () => void }) {
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState(false)
  const canCancel = job.cancellable && !cancelling

  const cancel = async () => {
    setCancelling(true)
    setCancelError(false)
    try {
      await cancelOperation(job.id)
      onCancelled()
    } catch {
      setCancelError(true)
      setCancelling(false)
    }
  }

  const { active, completed, failed } = job.parentSummary
  return (
    <li className="job-row">
      <div className="job-row__main">
        <p className="job-row__title">
          {job.action === 'add' ? 'Add' : 'Remove'} selection across {active + completed + failed} Collection{active + completed + failed === 1 ? '' : 's'}
        </p>
        <p className="job-row__progress">{progressLabel(job.progress)}</p>
        <p className="job-row__summary">
          {active} pending, {completed} done, {failed} failed
        </p>
      </div>
      <div className="job-row__actions">
        {job.status === 'active' && canCancel && (
          <button onClick={() => void cancel()} type="button">Cancel</button>
        )}
      </div>
      {cancelError && <p role="alert">Unable to cancel. Some children may already be committing.</p>}
    </li>
  )
}

/** Slide-over listing in-flight bulk operations; self-refreshing while open. */
export function JobDrawer({ onClose, pollMs = 2_000 }: { onClose?: () => void; pollMs?: number }) {
  const { jobs, loading, error, refresh } = useActiveOperations({ pollMs })
  return (
    <aside aria-label="Jobs em andamento" className="job-drawer">
      <header className="job-drawer__header">
        <h2>Jobs em andamento</h2>
        {onClose && <button onClick={onClose} type="button">Close</button>}
      </header>
      {error && <p role="alert">Unable to reach the server. Retrying.</p>}
      {!error && !loading && jobs.length === 0 && <p>No active jobs.</p>}
      {!error && jobs.length > 0 && (
        <ul className="job-drawer__list">
          {jobs.map((job) => <JobRow job={job} key={job.id} onCancelled={refresh} />)}
        </ul>
      )}
    </aside>
  )
}