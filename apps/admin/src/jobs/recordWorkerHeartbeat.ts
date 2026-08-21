import type { TaskConfig } from 'payload'
import { readRetentionPolicy } from '../maintenance/retention'

type RecordWorkerHeartbeatTask = {
  input: { workerId: string }
  output: { observedAt: string }
}

const scheduledWorkerId = process.env.CMS_WORKER_ID?.trim() || 'cms-admin-worker'

/**
 * Persists worker liveness through Payload's official task runner. The web
 * process never calls this handler: only `payload jobs:run` owns execution.
 */
export const recordWorkerHeartbeat: TaskConfig<RecordWorkerHeartbeatTask> = {
  slug: 'record-worker-heartbeat',
  inputSchema: [
    {
      name: 'workerId',
      type: 'text',
      required: true,
    },
  ],
  outputSchema: [
    {
      name: 'observedAt',
      type: 'date',
      required: true,
    },
  ],
  schedule: [
    {
      cron: '* * * * *',
      queue: 'maintenance',
      hooks: {
        beforeSchedule: async (args) => {
          const scheduled = await args.defaultBeforeSchedule(args)

          return {
            ...scheduled,
            input: { workerId: scheduledWorkerId },
          }
        },
      },
    },
  ],
  handler: async ({ input, req }) => {
    const observed = new Date()
    const retentionDays = readRetentionPolicy().heartbeatTtlDays
    const expiresAt = new Date(observed.getTime() + retentionDays * 86_400_000)

    await req.payload.create({
      collection: 'worker-heartbeats',
      data: {
        workerId: input.workerId,
        observedAt: observed.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
      overrideAccess: true,
    })

    return { output: { observedAt: observed.toISOString() } }
  },
}
