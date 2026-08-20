import type { TaskConfig } from 'payload'
import { archiveExpiredAuditEvents } from '../maintenance/purge'

export const archiveAuditEventsTask: TaskConfig<{
  input: Record<string, never>
  output: { batches: number; eventsArchived: number }
}> = {
  slug: 'archive-audit-events',
  schedule: [{ cron: '15 3 * * *', queue: 'maintenance' }],
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 10_000 } },
  inputSchema: [],
  outputSchema: [
    { name: 'batches', type: 'number', required: true },
    { name: 'eventsArchived', type: 'number', required: true },
  ],
  handler: async ({ req }) => {
    let batches = 0
    let eventsArchived = 0
    // Bound each scheduled invocation; a large backlog drains over subsequent
    // runs rather than monopolizing the worker indefinitely.
    while (batches < 20) {
      const manifest = await archiveExpiredAuditEvents(req.payload)
      if (!manifest) break
      batches += 1
      eventsArchived += manifest.count
    }
    return { output: { batches, eventsArchived } }
  },
}
