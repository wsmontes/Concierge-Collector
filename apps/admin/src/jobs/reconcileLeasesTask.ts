import type { TaskConfig } from 'payload'
import { reconcileLeases } from '../maintenance/reconciliation'

export const reconcileLeasesTask: TaskConfig<{
  input: Record<string, never>
  output: { operations: number; publishJobs: number; selections: number; exports: number; orphanStagesPurged: number }
}> = {
  slug: 'reconcile-leases',
  schedule: [{ cron: '*/5 * * * *', queue: 'maintenance' }],
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
  inputSchema: [],
  outputSchema: [
    { name: 'operations', type: 'number', required: true },
    { name: 'publishJobs', type: 'number', required: true },
    { name: 'selections', type: 'number', required: true },
    { name: 'exports', type: 'number', required: true },
    { name: 'orphanStagesPurged', type: 'number', required: true },
  ],
  handler: async ({ req }) => ({ output: await reconcileLeases(req.payload) }),
}
