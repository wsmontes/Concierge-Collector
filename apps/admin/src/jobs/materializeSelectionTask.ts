import type { TaskConfig } from 'payload'
import { materializeSelection } from '../selections/materialize-selection'

export const materializeSelectionTask: TaskConfig<{ input: { selectionId: string }; output: { status: string } }> = {
  slug: 'materialize-selection',
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
  inputSchema: [{ name: 'selectionId', type: 'text', required: true }],
  outputSchema: [{ name: 'status', type: 'text', required: true }],
  handler: async ({ input, req }) => {
    const selection = await materializeSelection(
      req.payload,
      input.selectionId,
      process.env.CMS_WORKER_ID?.trim() || 'cms-admin-worker',
    )
    return { output: { status: selection?.status ?? 'not_claimed' } }
  },
}
