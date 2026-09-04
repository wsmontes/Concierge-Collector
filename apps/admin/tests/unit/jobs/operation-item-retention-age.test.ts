import { expect, test, vi } from 'vitest'
import { compactTerminalOperationItems } from '../../../src/jobs/operation-item-retention'

const now = new Date('2026-09-04T12:00:00.000Z')
const old = new Date('2026-05-01T12:00:00.000Z')

async function* cursor() {
  yield { curationId: 'cur-1', desiredState: 'add', status: 'applied', reasonCode: null, targetDraftRevision: 2 }
}

test('summary and purge markers disable mongoose timestamps so failed retention remains immediately retryable', async () => {
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const operations = {
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([{
            _id: 'op-old', collectionId: 'collection-1', jobId: 'job-1',
            status: 'completed', selectedCount: 1, updatedAt: old,
          }]),
        }),
      }),
    }),
    updateOne,
  }
  const items = {
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        batchSize: vi.fn().mockReturnValue({ cursor: vi.fn(() => cursor()) }),
      }),
    }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: vi.fn().mockResolvedValue(0),
  }
  const payload = { db: { collections: {
    'collection-operations': operations,
    'collection-operation-items': items,
  } } }

  const result = await compactTerminalOperationItems(payload as never, now, { retentionDays: 90 })

  expect(result.compactedOperations).toBe(1)
  expect(updateOne).toHaveBeenCalledTimes(2)
  expect(updateOne.mock.calls[0][2]).toEqual({ timestamps: false })
  expect(updateOne.mock.calls[1][2]).toEqual({ timestamps: false })
})
