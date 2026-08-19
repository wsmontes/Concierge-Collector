import type { TaskConfig } from 'payload'
import { applyDraftOperation } from '../operations/apply-draft-operation'
import { observeCollectionTask } from '../observability/metrics'

export const applyDraftOperationTask: TaskConfig<{ input: { operationId: string }; output: { status: string } }> = {
  slug: 'apply-draft-operation',
  // Transient FastAPI or database failures deliberately leave the operation
  // reclaimable.  Payload owns retry scheduling so a worker crash cannot turn
  // an otherwise valid queued command into a terminal job failure.
  retries: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
  },
  inputSchema: [{ name: 'operationId', type: 'text', required: true }],
  outputSchema: [{ name: 'status', type: 'text', required: true }],
  handler: async ({ input, req }) => {
    const result = await observeCollectionTask(
      'draft_operation',
      () => applyDraftOperation(req.payload, input.operationId, process.env.CMS_WORKER_ID?.trim() || 'cms-admin-worker'),
      (operation) => operation?.status ?? 'not_claimed',
    )
    return { output: { status: result?.status ?? 'not_claimed' } }
  },
}
