import { expect, test, vi } from 'vitest'
import { compactTerminalOperationItems } from '../../../src/jobs/operation-item-retention'

const now = new Date('2026-09-04T12:00:00.000Z')
const old = new Date('2026-05-01T12:00:00.000Z')

async function* itemCursor(count: number) {
  for (let index = 0; index < count; index += 1) {
    yield {
      curationId: `cur-${String(index).padStart(6, '0')}`,
      desiredState: 'add',
      status: index % 2 === 0 ? 'applied' : 'skipped',
      reasonCode: index % 2 === 0 ? null : 'no_op',
      targetDraftRevision: 4,
    }
  }
}

test('hashes large operation detail through a bounded cursor instead of materializing all rows', async () => {
  const cursor = vi.fn(() => itemCursor(5_000))
  const batchSize = vi.fn().mockReturnValue({ cursor })
  const sortItems = vi.fn().mockReturnValue({ batchSize })
  const itemFind = vi.fn().mockReturnValue({ sort: sortItems })
  const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 5_000 })
  const operationFind = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{
          _id: 'op-large', collectionId: 'collection-1', jobId: 'job-1',
          status: 'completed_with_skips', selectedCount: 5_000, updatedAt: old,
        }]),
      }),
    }),
  })
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const payload = {
    db: { collections: {
      'collection-operations': { find: operationFind, updateOne },
      'collection-operation-items': { find: itemFind, deleteMany },
    } },
  }

  const result = await compactTerminalOperationItems(payload as never, now, { retentionDays: 90, batchSize: 10 })

  expect(result).toEqual({
    scannedOperations: 1,
    compactedOperations: 1,
    deletedItems: 5_000,
    preservedOperations: 0,
  })
  expect(itemFind).toHaveBeenCalledWith({ operationId: 'op-large' })
  expect(sortItems).toHaveBeenCalledWith({ curationId: 1, _id: 1 })
  expect(batchSize).toHaveBeenCalledWith(1_000)
  expect(cursor).toHaveBeenCalledTimes(1)
  expect(updateOne).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ _id: 'op-large', itemArchive: { $exists: false } }),
    { $set: { itemArchive: expect.objectContaining({ itemCount: 5_000, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }) } },
  )
})

test('retry after purgeStartedAt skips rehashing a potentially huge remaining subset', async () => {
  const itemFind = vi.fn(() => { throw new Error('detail must not be rescanned after destructive phase starts') })
  const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 127 })
  const operationFind = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{
          _id: 'op-retry-large', collectionId: 'collection-1', jobId: 'job-1', status: 'completed',
          selectedCount: 5_000, updatedAt: old,
          itemArchive: {
            itemCount: 5_000,
            statusCounts: { applied: 5_000 },
            reasonCounts: {},
            sha256: 'a'.repeat(64),
            purgeStartedAt: '2026-09-03T00:00:00.000Z',
          },
        }]),
      }),
    }),
  })
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const payload = {
    db: { collections: {
      'collection-operations': { find: operationFind, updateOne },
      'collection-operation-items': { find: itemFind, deleteMany },
    } },
  }

  const result = await compactTerminalOperationItems(payload as never, now, { retentionDays: 90, batchSize: 10 })

  expect(result.compactedOperations).toBe(1)
  expect(result.deletedItems).toBe(127)
  expect(itemFind).not.toHaveBeenCalled()
  expect(deleteMany).toHaveBeenCalledWith({ operationId: 'op-retry-large' })
})
