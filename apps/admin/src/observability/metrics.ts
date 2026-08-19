import { timingSafeEqual } from 'node:crypto'
import { Counter, Gauge, Histogram, Registry } from 'prom-client'

export const adminMetrics = new Registry()

export const collectionJobsTotal = new Counter({
  name: 'concierge_admin_collection_jobs_total',
  help: 'Collection jobs by stable state and kind',
  labelNames: ['kind', 'state'] as const,
  registers: [adminMetrics],
})

export const collectionJobDurationSeconds = new Histogram({
  name: 'concierge_admin_collection_job_duration_seconds',
  help: 'Collection job duration by kind and final state',
  labelNames: ['kind', 'state'] as const,
  registers: [adminMetrics],
})

export const collectionQueueDepth = new Gauge({
  name: 'concierge_admin_collection_queue_depth',
  help: 'Observed queue depth by queue name',
  labelNames: ['queue'] as const,
  registers: [adminMetrics],
})

function equalSecret(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function authorizeMetrics(headers: Headers, metricsKey: string): void {
  const supplied = headers.get('x-metrics-key') ?? ''
  if (!supplied || !equalSecret(supplied, metricsKey)) {
    throw new Error('metrics_unauthorized')
  }
}

export async function observeCollectionTask<T>(
  kind: 'draft_operation' | 'publish',
  run: () => Promise<T>,
  stateOf: (result: T) => string,
): Promise<T> {
  const started = performance.now()
  try {
    const result = await run()
    const state = stateOf(result)
    collectionJobsTotal.labels(kind, state).inc()
    collectionJobDurationSeconds.labels(kind, state).observe((performance.now() - started) / 1_000)
    return result
  } catch (error) {
    collectionJobsTotal.labels(kind, 'failed').inc()
    collectionJobDurationSeconds.labels(kind, 'failed').observe((performance.now() - started) / 1_000)
    throw error
  }
}
