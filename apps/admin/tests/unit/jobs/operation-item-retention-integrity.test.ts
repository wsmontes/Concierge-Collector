import { expect, test, vi } from 'vitest'
import { compactTerminalOperationItems } from '../../../src/jobs/operation-item-retention'

const now = new Date('2026-09-04T12:00:00.000Z')
const old = new Date('2026-05-01T12:00:00.000Z')

async function* cursorFor(items: Record<string, unknown>[]) {
  for (const item of items) yield item
}

function harness(operation: Record<string, unknown> | null, items: Record<string, unknown>[]) {
  const operationFind = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(operation ? [operation] : []),
      }),
    }),
  })
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  let remaining = items.length
  const deleteMany = vi.fn().mockImplementation(async () => {
    const removed = remaining
    remaining = 0
    return { deletedCount: removed }
  })
  const countDocuments = vi.fn().mockImplementation(async () => remaining)
  const cursor = vi.fn(() => cursorFor(items))
  const batchSize = vi.fn().mockReturnValue({ cursor })
  const itemFind = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({ batchSize }),
  })
  return {
    payload: { db: { collections: {
      'collection-operations': { find: operationFind, updateOne },
      'collection-operation-items': { find: itemFind, deleteMany, countDocuments },
    } } },
    operationFind,
    itemFind,
    cursor,
    updateOne,
    deleteMany,
  }
}

test('retention scan excludes aggregate parents and previously quarantined operations', async () => {
  const { payload, operationFind } = harness(null, [])

  await compactTerminalOperationItems(payload as never, now, { retentionDays: 90, batchSize: 10 })

  expect(operationFind).toHaveBeenCalledWith(expect.objectContaining({
    collectionId: { $exists: true, $ne: null },
    jobId: { $exists: true, $ne: null },
    'itemArchive.itemsPurgedAt': { $exists: false },
    'itemArchive.retentionBlockedAt': { $exists: false },
  }))
})

test('successful operation with missing item detail is quarantined before destructive retention starts', async () => {
  const { payload, updateOne, deleteMany } = harness({
    _id: 'op-success-corrupt',
    collectionId: 'collection-1',
    jobId: 'job-1',
    status: 'completed',
    selectedCount: 3,
    updatedAt: old,
  }, [
    { curationId: 'cur-1', desiredState: 'add', status: 'applied', targetDraftRevision: 8 },
    { curationId: 'cur-2', desiredState: 'add', status: 'skipped', reasonCode: 'no_op', targetDraftRevision: 8 },
  ])

  const result = await compactTerminalOperationItems(payload as never, now, { retentionDays: 90, batchSize: 10 })

  expect(result).toEqual({ scannedOperations: 1, compactedOperations: 0, deletedItems: 0, preservedOperations: 1 })
  expect(updateOne).toHaveBeenCalledWith(
    expect.objectContaining({
      _id: 'op-success-corrupt',
      'itemArchive.retentionBlockedAt': { $exists: false },
    }),
    { $set: expect.objectContaining({
      'itemArchive.retentionBlockedReason': 'detail_count_mismatch',
      'itemArchive.retentionExpectedItemCount': 3,
      'itemArchive.retentionObservedItemCount': 2,
    }) },
    { timestamps: false },
  )
  expect(deleteMany).not.toHaveBeenCalled()
})

test('failed or cancelled selection operations may retain partial item detail because materialization can stop early', async () => {
  const { payload, deleteMany } = harness({
    _id: 'op-failed-partial',
    collectionId: 'collection-1',
    jobId: 'job-1',
    status: 'failed',
    selectedCount: 3,
    updatedAt: old,
  }, [
    { curationId: 'cur-1', desiredState: 'add', status: 'failed', reasonCode: 'upstream_failure', targetDraftRevision: 8 },
  ])

  const result = await compactTerminalOperationItems(payload as never, now, { retentionDays: 90, batchSize: 10 })

  expect(result.compactedOperations).toBe(1)
  expect(deleteMany).toHaveBeenCalledWith({ operationId: 'op-failed-partial' })
})