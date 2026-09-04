import { expect, test, vi } from 'vitest'
import { purgeExpiredExports } from '../../../src/jobs/purgeExpiredArtifactsTask'

const now = new Date('2026-09-04T12:00:00.000Z')

function payloadWith(rows: Record<string, unknown>[]) {
  const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 })
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const sort = vi.fn().mockReturnValue({
    limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(rows) }),
  })
  const find = vi.fn().mockReturnValue({ sort })
  return {
    payload: { db: { collections: { 'collection-exports': { find, updateOne, deleteOne } } } },
    find,
    sort,
    updateOne,
    deleteOne,
  }
}

test('deletes object before deleting an expired export record', async () => {
  const { payload, deleteOne } = payloadWith([{
    _id: 'export-1', status: 'complete', key: 'cms/exports/selection-1.ndjson', expiresAt: new Date('2026-09-03T12:00:00Z'),
  }])
  const order: string[] = []
  const store = {
    put: vi.fn(), readUrl: vi.fn(),
    delete: vi.fn().mockImplementation(async () => { order.push('object') }),
  }
  deleteOne.mockImplementation(async () => { order.push('record'); return { deletedCount: 1 } })

  const result = await purgeExpiredExports(payload as never, store as never, now, { batchSize: 50 })

  expect(result).toEqual({ scanned: 1, deleted: 1, preserved: 0 })
  expect(store.delete).toHaveBeenCalledWith('cms/exports/selection-1.ndjson')
  expect(order).toEqual(['object', 'record'])
})

test('preserves the CMS reference and schedules retry when object deletion fails', async () => {
  const { payload, deleteOne, updateOne } = payloadWith([{
    _id: 'export-2', status: 'complete', key: 'cms/exports/selection-2.ndjson', expiresAt: new Date('2026-09-03T12:00:00Z'),
  }])
  const store = { put: vi.fn(), readUrl: vi.fn(), delete: vi.fn().mockRejectedValue(new Error('storage unavailable')) }

  const result = await purgeExpiredExports(payload as never, store as never, now)

  expect(result).toEqual({ scanned: 1, deleted: 0, preserved: 1 })
  expect(deleteOne).not.toHaveBeenCalled()
  expect(updateOne).toHaveBeenCalledTimes(1)
})

test('purges an expired failed export that never materialized an object', async () => {
  const { payload, deleteOne } = payloadWith([{
    _id: 'export-3', status: 'failed', key: null, expiresAt: new Date('2026-09-03T12:00:00Z'),
  }])
  const store = { put: vi.fn(), readUrl: vi.fn(), delete: vi.fn() }

  const result = await purgeExpiredExports(payload as never, store as never, now)

  expect(result).toEqual({ scanned: 1, deleted: 1, preserved: 0 })
  expect(store.delete).not.toHaveBeenCalled()
  expect(deleteOne).toHaveBeenCalledTimes(1)
})

test('queries only due expired terminal export records in bounded batches', async () => {
  const { payload, find, sort } = payloadWith([])
  const store = { put: vi.fn(), readUrl: vi.fn(), delete: vi.fn() }

  await purgeExpiredExports(payload as never, store as never, now, { batchSize: 17 })

  expect(find).toHaveBeenCalledWith({
    expiresAt: { $lte: now },
    status: { $in: ['complete', 'failed'] },
    $or: [
      { cleanupNextAttemptAt: { $exists: false } },
      { cleanupNextAttemptAt: null },
      { cleanupNextAttemptAt: { $lte: now } },
    ],
  })
  expect(sort).toHaveBeenCalledWith({ cleanupNextAttemptAt: 1, expiresAt: 1, _id: 1 })
})