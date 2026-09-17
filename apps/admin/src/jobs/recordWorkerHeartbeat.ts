import type { TaskConfig } from 'payload'

type RecordWorkerHeartbeatTask = {
  input: { workerId: string }
  output: { observedAt: string }
}

const scheduledWorkerId = process.env.CMS_WORKER_ID?.trim() || 'cms-admin-worker'

/**
 * Persists worker liveness through Payload's official task runner.
 *
 * Quem executa é o RUNNER de jobs — processo dedicado ou o runner in-process
 * dentro do Admin (`src/jobs/inProcessRunner.ts`, desde que o worker dedicado
 * saiu do container). O que a frase antiga ("o processo web nunca chama este
 * handler") protegia continua valendo: um request de página não executa task —
 * só `payload.jobs.run()` drena a fila, e a liveness vem de lá.
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
    const observedAt = new Date().toISOString()

    await req.payload.create({
      collection: 'worker-heartbeats',
      data: {
        workerId: input.workerId,
        observedAt,
      },
      overrideAccess: true,
    })

    return { output: { observedAt } }
  },
}
