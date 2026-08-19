import type { TaskConfig } from 'payload'
import { failPublishJob, runPublishJob } from '../publishing/publish-collection'
import { observeCollectionTask } from '../observability/metrics'

export const publishCollectionTask: TaskConfig<{ input: { publishJobId: string }; output: { status: string } }> = {
  slug: 'publish-collection',
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
  inputSchema: [{ name: 'publishJobId', type: 'text', required: true }],
  outputSchema: [{ name: 'status', type: 'text', required: true }],
  handler: async ({ input, job, req }) => {
    try {
      const result = await observeCollectionTask(
        'publish',
        () => runPublishJob(req.payload, input.publishJobId, process.env.CMS_WORKER_ID?.trim() || 'cms-admin-worker'),
        (jobResult) => jobResult?.status ?? 'not_claimed',
      )
      return { output: { status: result?.status ?? 'not_claimed' } }
    } catch (error) {
      // Payload increments totalTried after this handler returns. With three
      // attempts, `2` is the last chance to release the CMS-side lock.
      if ((job.totalTried ?? 0) >= 2) await failPublishJob(req.payload, input.publishJobId)
      throw error
    }
  },
}
