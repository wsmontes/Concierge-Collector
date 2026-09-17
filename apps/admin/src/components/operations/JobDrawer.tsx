'use client'

import { Button } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Drawer } from '../ui/Drawer'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { InlineNotice } from '../ui/InlineNotice'
import { SkeletonRows } from '../ui/Skeleton'
import { StatusPill } from '../ui/StatusPill'

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

function JobEntry({ job, onCancelled }: { job: ActiveJobRow; onCancelled: () => void }) {
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
  const children = active + completed + failed
  return (
    <li className="jobs-entry">
      <div className="jobs-entry__head">
        <strong className="jobs-entry__title">
          {job.action === 'add' ? 'Add' : 'Remove'} selection across {children} Collection{children === 1 ? '' : 's'}
        </strong>
        <StatusPill status={job.status} />
      </div>
      <p className="jobs-entry__progress">{progressLabel(job.progress)}</p>
      <p className="jobs-entry__summary">{active} pending, {completed} done, {failed} failed</p>
      {job.status === 'active' && canCancel && (
        <div className="jobs-entry__actions">
          <Button
            buttonStyle="error"
            disabled={cancelling}
            margin={false}
            onClick={() => void cancel()}
            size="small"
            type="button"
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </Button>
        </div>
      )}
      {cancelError && (
        <InlineNotice tone="error">
          <p>Unable to cancel. Some children may already be committing.</p>
        </InlineNotice>
      )}
    </li>
  )
}

/**
 * Detalhe das operações em voo, dentro do `Drawer` do Payload (o overlay caseiro
 * que existia aqui — um `<aside>` sem `aria-modal`, sem `Esc` e fora da camada de
 * modal — foi removido). Quem monta decide quando: o pai só renderiza quando o
 * painel está aberto, então `open` é sempre verdadeiro e o `onClose` do pai é
 * quem desmonta.
 */
export function JobDrawer({ onClose, pollMs = 2_000 }: { onClose?: () => void; pollMs?: number }) {
  const { jobs, loading, error, refresh } = useActiveOperations({ pollMs })
  return (
    <Drawer onClose={() => onClose?.()} open title="Active jobs">
      {error && (
        <ErrorState
          description="The jobs list could not be read. Polling keeps retrying on its own in the background."
          onRetry={refresh}
          retryLabel="Try again"
          title="Unable to reach the server"
        />
      )}
      {!error && loading && <SkeletonRows rows={3} />}
      {!error && !loading && jobs.length === 0 && (
        <EmptyState
          description="Bulk work started from the Curation Explorer appears here while it runs."
          title="No active jobs"
        />
      )}
      {!error && jobs.length > 0 && (
        <ul className="jobs-list" aria-label="Active jobs">
          {jobs.map((job) => <JobEntry job={job} key={job.id} onCancelled={refresh} />)}
        </ul>
      )}
    </Drawer>
  )
}
