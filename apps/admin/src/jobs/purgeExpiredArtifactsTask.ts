import type { TaskConfig } from 'payload'
import { purgeExpiredArtifacts } from '../maintenance/purge'

export const purgeExpiredArtifactsTask: TaskConfig<{
  input: Record<string, never>
  output: { exportsPurged: number; orphanStagesPurged: number; operationItemsArchived: number }
}> = {
  slug: 'purge-expired-artifacts',
  schedule: [{ cron: '15 2 * * *', queue: 'maintenance' }],
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 10_000 } },
  inputSchema: [],
  outputSchema: [
    { name: 'exportsPurged', type: 'number', required: true },
    { name: 'orphanStagesPurged', type: 'number', required: true },
    { name: 'operationItemsArchived', type: 'number', required: true },
  ],
  handler: async ({ req }) => ({ output: await purgeExpiredArtifacts(req.payload) }),
}
