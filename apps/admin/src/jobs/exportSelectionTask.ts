import type { TaskConfig } from 'payload'
import { createExport, runExportSelection } from '../exports/export-selection'
import { FastApiExportHydrationClient } from '../exports/hydration-client'
import type { ExportFormat, ExportHydrationClient, ExportStatus } from '../exports/types'
import { AdminHttpError } from '../http/errors'
import type { ArtifactStore } from '../storage/artifact-store'
import { createS3ArtifactStore } from '../storage/s3-artifact-store'
import type { Payload } from 'payload'

function workerId(): string {
  return process.env.CMS_WORKER_ID?.trim() || 'cms-admin-worker'
}

/** Lazily loads the Payload instance (test convenience; never a boot import cycle). */
async function currentPayload(): Promise<Payload> {
  const [{ default: config }, { getPayload }] = await Promise.all([
    import('../../payload.config'),
    import('payload'),
  ])
  return getPayload({ config })
}

export interface ExportTaskRunResult {
  exportId: string
  status: ExportStatus | 'not_claimed'
  downloadUrl: string | null
  downloadExpiresAt: Date | null
}

export interface ExportTaskRunDependencies {
  client?: ExportHydrationClient
  payload?: Payload
  signedUrlTtlSeconds?: number
  store?: ArtifactStore
}

type ExportTask = TaskConfig<{ input: { exportId: string; selectionId: string }; output: { status: string } }> & {
  /** Direct invocation used by integration tests; production only uses `handler`. */
  run(input: { selectionId: string; format: ExportFormat }, dependencies?: ExportTaskRunDependencies): Promise<ExportTaskRunResult>
}

export const exportSelectionTask: ExportTask = {
  slug: 'export-selection',
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
  inputSchema: [
    { name: 'selectionId', type: 'text', required: true },
    { name: 'exportId', type: 'text', required: true },
  ],
  outputSchema: [{ name: 'status', type: 'text', required: true }],
  handler: async ({ input, req }) => {
    const result = await runExportSelection(req.payload, input.exportId, workerId(), {
      store: createS3ArtifactStore(),
    })
    return { output: { status: result?.status ?? 'not_claimed' } }
  },
  run: async (input, dependencies = {}) => {
    const payload = dependencies.payload ?? (await currentPayload())
    const client = dependencies.client ?? new FastApiExportHydrationClient()
    const store = dependencies.store ?? createS3ArtifactStore()

    const manifests = payload.db.collections['selection-manifests'] as unknown as {
      findOne: (filter: Record<string, unknown>) => Promise<{ actorId?: unknown } | null>
    }
    const selection = await manifests.findOne({ _id: input.selectionId })
    if (!selection || typeof selection.actorId !== 'string') throw new AdminHttpError(404, 'not_found')

    // Deterministic intent so re-running the same input reuses the same export
    // record; requestId stays unique per invocation and is not part of the hash.
    const record = await createExport(payload, {
      selectionId: input.selectionId,
      actorId: selection.actorId,
      format: input.format,
      idempotencyKey: `task-run:${input.selectionId}:${input.format}`,
      requestId: `task-run:${input.selectionId}:${input.format}:${Date.now()}`,
    }, client)

    const result = await runExportSelection(payload, record.id, workerId(), {
      store,
      client,
      ...(dependencies.signedUrlTtlSeconds !== undefined ? { signedUrlTtlSeconds: dependencies.signedUrlTtlSeconds } : {}),
    })
    if (result) return result
    return { exportId: record.id, status: 'not_claimed', downloadUrl: null, downloadExpiresAt: null }
  },
}
