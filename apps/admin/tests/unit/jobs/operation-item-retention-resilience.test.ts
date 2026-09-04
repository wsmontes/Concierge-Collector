import { expect, test, vi } from 'vitest'
import { compactTerminalOperationItems } from '../../../src/jobs/operation-item-retention'

const now = new Date('2026-09-04T12:00:00.000Z')
const old = new Date('2026-05-01T12:00:00.000Z')

async function* failingCursor() {
  throw new Error('cursor interrupted')
}

async function* healthyCursor() {
  yield { curationId: 'cur-ok', desiredState: 'add', status: 'applied', reasonCode: null, targetDraftRevision: 2 }
}

test('a detail cursor failure preserves that operation and continues with later candidates', async () => {
  const operations = [
    { _id: 'op-bad', collectionId: 'collection-1', jobId: 'job-bad', status: 'completed', selectedCount: 1, updatedAt: old },
    { _id: 'op-good', collectionId: 'collection-2', jobId: 'job-good', status: 'completed', selectedCount: 1, updatedAt: old },
  ]
  const operationFind = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(operations) }) }),
  })
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 1 })
  const countDocuments = vi.fn().mockResolvedValue(0)
  const itemFind = vi.fn(({ operationId }: { operationId: string }) => ({
    sort: vi.fn().mockReturnValue({
      batchSize: vi.fn().mockReturnValue({
        cursor: vi.fn(() => operationId === 'op-bad' ? failingCursor() : healthyCursor()),
      }),
    }),
  }))
  const payload = {
    db: { collections: {
      'collection-operations': { find: operationFind, updateOne },
      'collection-operation-items': { find: itemFind, deleteMany, countDocuments },
    } },
  }

  const result = await compactTerminalOperationItems(payload as never, now, { retentionDays: 90, batchSize: 10 })

  expect(result).toEqual({ scannedOperations: 2, compactedOperations: 1, deletedItems: 1, preservedOperations: 1 })
  expect(deleteMany).toHaveBeenCalledTimes(1)
  expect(deleteMany).toHaveBeenCalledWith({ operationId: 'op-good' })
  expect(updateOne).toHaveBeenCalledWith(
    expect.objectContaining({ _id: 'op-good', itemArchive: { $exists: false } }),
    expect.objectContaining({ $set: { itemArchive: expect.objectContaining({ itemCount: 1 }) } }),
  )
})
