import { expect, test, vi } from 'vitest'
import { up as upExport, down as downExport } from '../../../src/migrations/20260904_015_export_cleanup_backoff'
import { up as upOperation, down as downOperation } from '../../../src/migrations/20260904_016_operation_retention_quarantine'

function payloadWith(slug: string, raw: { createIndex: ReturnType<typeof vi.fn>; dropIndex: ReturnType<typeof vi.fn> }) {
  return {
    db: {
      name: 'mongoose',
      collections: { [slug]: { collection: raw } },
    },
  }
}

test('export cleanup backoff installs due-work compound index', async () => {
  const raw = { createIndex: vi.fn().mockResolvedValue('export_cleanup_due'), dropIndex: vi.fn() }

  await upExport({ payload: payloadWith('collection-exports', raw) } as never)

  expect(raw.createIndex).toHaveBeenCalledWith(
    { status: 1, cleanupNextAttemptAt: 1, expiresAt: 1, _id: 1 },
    { name: 'export_cleanup_due' },
  )
})

test('operation retention quarantine installs unblocked due-work index', async () => {
  const raw = { createIndex: vi.fn().mockResolvedValue('operation_retention_due'), dropIndex: vi.fn() }

  await upOperation({ payload: payloadWith('collection-operations', raw) } as never)

  expect(raw.createIndex).toHaveBeenCalledWith(
    {
      status: 1,
      'itemArchive.itemsPurgedAt': 1,
      'itemArchive.retentionBlockedAt': 1,
      updatedAt: 1,
      _id: 1,
    },
    { name: 'operation_retention_due' },
  )
})

test('both down migrations tolerate an already-missing index and never mutate data', async () => {
  const missing = Object.assign(new Error('missing'), { code: 27, codeName: 'IndexNotFound' })
  const exportRaw = { createIndex: vi.fn(), dropIndex: vi.fn().mockRejectedValue(missing) }
  const operationRaw = { createIndex: vi.fn(), dropIndex: vi.fn().mockRejectedValue(missing) }

  await expect(downExport({ payload: payloadWith('collection-exports', exportRaw) } as never)).resolves.toBeUndefined()
  await expect(downOperation({ payload: payloadWith('collection-operations', operationRaw) } as never)).resolves.toBeUndefined()
  expect(exportRaw.dropIndex).toHaveBeenCalledWith('export_cleanup_due')
  expect(operationRaw.dropIndex).toHaveBeenCalledWith('operation_retention_due')
  expect(exportRaw.createIndex).not.toHaveBeenCalled()
  expect(operationRaw.createIndex).not.toHaveBeenCalled()
})