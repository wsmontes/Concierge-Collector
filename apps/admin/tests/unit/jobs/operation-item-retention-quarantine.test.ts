import { createHash } from 'node:crypto'
import { expect, test, vi } from 'vitest'
import { compactTerminalOperationItems } from '../../../src/jobs/operation-item-retention'

const now = new Date('2026-09-04T12:00:00.000Z')
const old = new Date('2026-05-01T12:00:00.000Z')

async function* rows(values: Record<string, unknown>[]) {
  for (const value of values) yield value
}

function itemQuery(items: Record<string, unknown>[]) {
  return {
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        batchSize: vi.fn().mockReturnValue({ cursor: vi.fn(() => rows(items)) }),
      }),
    }),
    deleteMany: vi.fn(),
    countDocuments: vi.fn(),
  }
}

function harness(operation: Record<string, unknown>, items: Record<string, unknown>[]) {
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const find = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([operation]) }),
    }),
  })
  const itemModel = itemQuery(items)
  return {
    payload: { db: { collections: {
      'collection-operations': { find, updateOne },
      'collection-operation-items': itemModel,
    } } },
    find, updateOne, itemModel,
  }
}

function detail() {
  return [{
    curationId: 'cur-1', desiredState: 'add', status: 'applied', reasonCode: null,
    targetDraftRevision: 7,
  }]
}

function shaFor(items: Record<string, unknown>[]) {
  const lines = items.map((row) => JSON.stringify({
    curationId: row.curationId,
    desiredState: row.desiredState,
    status: row.status,
    reasonCode: row.reasonCode ?? null,
    targetDraftRevision: row.targetDraftRevision,
  })).join('\n') + '\n'
  return createHash('sha256').update(lines).digest('hex')
}

test('successful operation with impossible selectedCount is quarantined without deleting detail', async () => {
  const items = detail()
  const { payload, updateOne, itemModel } = harness({
    _id: 'op-count-corrupt', collectionId: 'collection-1', jobId: 'job-1',
    status: 'completed', selectedCount: 3, updatedAt: old,
  }, items)

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result.preservedOperations).toBe(1)
  expect(itemModel.deleteMany).not.toHaveBeenCalled()
  expect(updateOne).toHaveBeenCalledWith(
    {
      _id: 'op-count-corrupt', status: 'completed', updatedAt: old,
      'itemArchive.retentionBlockedAt': { $exists: false },
    },
    { $set: expect.objectContaining({
      'itemArchive.retentionBlockedAt': now.toISOString(),
      'itemArchive.retentionBlockedReason': 'detail_count_mismatch',
      'itemArchive.retentionExpectedItemCount': 3,
      'itemArchive.retentionObservedItemCount': 1,
      'itemArchive.retentionObservedSha256': shaFor(items),
    }) },
    { timestamps: false },
  )
})

test('pre-purge archive mismatch is quarantined while preserving raw detail and original archive', async () => {
  const items = detail()
  const { payload, updateOne, itemModel } = harness({
    _id: 'op-archive-corrupt', collectionId: 'collection-1', jobId: 'job-1',
    status: 'completed', selectedCount: 1, updatedAt: old,
    itemArchive: {
      itemCount: 1,
      statusCounts: { applied: 1 },
      reasonCounts: {},
      sha256: '0'.repeat(64),
      compactedAt: '2026-09-01T00:00:00.000Z',
      sourceUpdatedAt: old.toISOString(),
    },
  }, items)

  await compactTerminalOperationItems(payload as never, now)

  expect(itemModel.deleteMany).not.toHaveBeenCalled()
  expect(updateOne).toHaveBeenCalledWith(
    expect.objectContaining({
      _id: 'op-archive-corrupt',
      'itemArchive.sha256': '0'.repeat(64),
      'itemArchive.retentionBlockedAt': { $exists: false },
    }),
    { $set: expect.objectContaining({
      'itemArchive.retentionBlockedReason': 'archive_evidence_mismatch',
      'itemArchive.retentionObservedSha256': shaFor(items),
      'itemArchive.retentionObservedItemCount': 1,
    }) },
    { timestamps: false },
  )
})

test('retention scan excludes previously quarantined operations before applying batch limit', async () => {
  const { payload, find } = harness({
    _id: 'unused', collectionId: 'collection-1', jobId: 'job-1', status: 'completed', selectedCount: 0, updatedAt: old,
  }, [])

  await compactTerminalOperationItems(payload as never, now, { batchSize: 23 })

  expect(find).toHaveBeenCalledWith(expect.objectContaining({
    'itemArchive.itemsPurgedAt': { $exists: false },
    'itemArchive.retentionBlockedAt': { $exists: false },
  }))
})

test('invalid immutable itemCount after destructive phase is quarantined before deleting any remaining detail', async () => {
  const remainingDetail = detail()
  const { payload, updateOne, itemModel } = harness({
    _id: 'op-invalid-archive-count', collectionId: 'collection-1', jobId: 'job-1',
    status: 'failed', selectedCount: 5, updatedAt: old,
    itemArchive: {
      itemCount: 'not-a-count', statusCounts: {}, reasonCounts: {}, sha256: 'a'.repeat(64),
      purgeStartedAt: '2026-09-03T00:00:00.000Z',
    },
  }, remainingDetail)
  itemModel.deleteMany.mockResolvedValue({ deletedCount: remainingDetail.length })
  itemModel.countDocuments.mockResolvedValue(0)

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result.preservedOperations).toBe(1)
  expect(result.deletedItems).toBe(0)
  expect(itemModel.deleteMany).not.toHaveBeenCalled()
  expect(itemModel.countDocuments).not.toHaveBeenCalled()
  expect(updateOne).toHaveBeenCalledWith(
    expect.objectContaining({
      _id: 'op-invalid-archive-count',
      'itemArchive.sha256': 'a'.repeat(64),
      'itemArchive.retentionBlockedAt': { $exists: false },
    }),
    { $set: expect.objectContaining({
      'itemArchive.retentionBlockedReason': 'invalid_archive_item_count',
    }) },
    { timestamps: false },
  )
})
