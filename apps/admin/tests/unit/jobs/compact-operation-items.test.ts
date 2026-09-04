import { createHash } from 'node:crypto'
import { expect, test, vi } from 'vitest'
import { compactTerminalOperationItems } from '../../../src/jobs/operation-item-retention'

const now = new Date('2026-09-04T12:00:00.000Z')
const old = new Date('2026-05-01T12:00:00.000Z')
const retentionWriteOptions = { timestamps: false }

function canonical(items: Record<string, unknown>[]) {
  return items.map((item) => JSON.stringify({
    curationId: item.curationId,
    desiredState: item.desiredState,
    status: item.status,
    reasonCode: item.reasonCode ?? null,
    targetDraftRevision: item.targetDraftRevision,
  })).join('\n') + (items.length ? '\n' : '')
}

function archiveFor(items: Record<string, unknown>[]) {
  const statusCounts: Record<string, number> = {}
  const reasonCounts: Record<string, number> = {}
  for (const item of items) {
    if (typeof item.status === 'string') statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1
    if (typeof item.reasonCode === 'string') reasonCounts[item.reasonCode] = (reasonCounts[item.reasonCode] ?? 0) + 1
  }
  return {
    itemCount: items.length,
    statusCounts,
    reasonCounts,
    sha256: createHash('sha256').update(canonical(items)).digest('hex'),
    compactedAt: '2026-09-03T12:00:00.000Z',
    sourceUpdatedAt: old.toISOString(),
  }
}

function operation(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'op-1',
    collectionId: 'collection-1',
    jobId: 'job-1',
    status: 'completed',
    selectedCount: 1,
    updatedAt: old,
    ...overrides,
  }
}

async function* cursorFor(items: Record<string, unknown>[]) {
  for (const item of items) yield item
}

function harness(input: {
  operations: Record<string, unknown>[]
  items: Record<string, unknown>[]
  persist?: boolean
  deleteFails?: boolean
  deletedCount?: number
}) {
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: input.persist === false ? 0 : 1 })
  let remaining = input.items.length
  const deleteMany = vi.fn().mockImplementation(async () => {
    if (input.deleteFails) throw new Error('delete failed')
    const removed = input.deletedCount ?? remaining
    remaining = Math.max(0, remaining - removed)
    return { deletedCount: removed }
  })
  const countDocuments = vi.fn().mockImplementation(async () => remaining)
  const operationFind = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(input.operations) }) }),
  })
  const cursor = vi.fn(() => cursorFor(input.items))
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
    countDocuments,
  }
}

test('persists deterministic evidence before deleting old successful operation items', async () => {
  const items = [
    { curationId: 'cur-1', desiredState: 'add', status: 'applied', reasonCode: null, targetDraftRevision: 7 },
    { curationId: 'cur-2', desiredState: 'add', status: 'skipped', reasonCode: 'unavailable', targetDraftRevision: 7 },
    { curationId: 'cur-3', desiredState: 'add', status: 'skipped', reasonCode: 'unavailable', targetDraftRevision: 7 },
  ]
  const { payload, updateOne, deleteMany, countDocuments } = harness({
    operations: [operation({ _id: 'op-summary', status: 'completed_with_skips', selectedCount: 3 })],
    items,
  })

  const result = await compactTerminalOperationItems(payload as never, now, { retentionDays: 90, batchSize: 10 })

  const expectedSha = createHash('sha256').update(canonical(items)).digest('hex')
  expect(result).toEqual({ scannedOperations: 1, compactedOperations: 1, deletedItems: 3, preservedOperations: 0 })
  expect(updateOne).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ _id: 'op-summary', status: 'completed_with_skips', itemArchive: { $exists: false } }),
    { $set: { itemArchive: expect.objectContaining({
      itemCount: 3,
      statusCounts: { applied: 1, skipped: 2 },
      reasonCounts: { unavailable: 2 },
      sha256: expectedSha,
      purgeStartedAt: now.toISOString(),
    }) } },
    retentionWriteOptions,
  )
  expect(updateOne.mock.invocationCallOrder[0]).toBeLessThan(deleteMany.mock.invocationCallOrder[0])
  expect(countDocuments).toHaveBeenCalledWith({ operationId: 'op-summary' })
  expect(updateOne).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ _id: 'op-summary', 'itemArchive.sha256': expectedSha, 'itemArchive.purgeStartedAt': { $exists: true } }),
    { $set: { 'itemArchive.itemsPurgedAt': now.toISOString(), 'itemArchive.purgedItemCount': 3 } },
    retentionWriteOptions,
  )
})

test('does not delete item rows if summary CAS is not persisted', async () => {
  const items = [{ curationId: 'cur-1', desiredState: 'remove', status: 'applied', targetDraftRevision: 9 }]
  const { payload, deleteMany } = harness({ operations: [operation()], items, persist: false })

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result.preservedOperations).toBe(1)
  expect(deleteMany).not.toHaveBeenCalled()
})

test('keeps an archived operation retryable when item deletion fails', async () => {
  const items = [{ curationId: 'cur-1', desiredState: 'remove', status: 'applied', targetDraftRevision: 9 }]
  const itemArchive = archiveFor(items)
  const { payload, updateOne, deleteMany } = harness({
    operations: [operation({ _id: 'op-retry', itemArchive })],
    items,
    deleteFails: true,
  })

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result).toEqual({ scannedOperations: 1, compactedOperations: 0, deletedItems: 0, preservedOperations: 1 })
  expect(updateOne).toHaveBeenCalledWith(
    expect.objectContaining({ _id: 'op-retry', 'itemArchive.sha256': itemArchive.sha256, 'itemArchive.purgeStartedAt': { $exists: false } }),
    { $set: { 'itemArchive.purgeStartedAt': now.toISOString() } },
    retentionWriteOptions,
  )
  expect(deleteMany).toHaveBeenCalledTimes(1)
})

test('rerun reuses the immutable archive and completes a retry', async () => {
  const items = [{ curationId: 'cur-1', desiredState: 'remove', status: 'applied', targetDraftRevision: 9 }]
  const itemArchive = archiveFor(items)
  const { payload, updateOne, deleteMany } = harness({ operations: [operation({ _id: 'op-retry', itemArchive })], items })

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result).toEqual({ scannedOperations: 1, compactedOperations: 1, deletedItems: 1, preservedOperations: 0 })
  expect(deleteMany).toHaveBeenCalledWith({ operationId: 'op-retry' })
  expect(updateOne).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ _id: 'op-retry', 'itemArchive.sha256': itemArchive.sha256, 'itemArchive.purgeStartedAt': { $exists: true } }),
    { $set: { 'itemArchive.itemsPurgedAt': now.toISOString(), 'itemArchive.purgedItemCount': 1 } },
    retentionWriteOptions,
  )
})

test('recovers after a partial delete using the original pre-delete archive', async () => {
  const originalItems = [
    { curationId: 'cur-1', desiredState: 'remove', status: 'applied', targetDraftRevision: 9 },
    { curationId: 'cur-2', desiredState: 'remove', status: 'applied', targetDraftRevision: 9 },
    { curationId: 'cur-3', desiredState: 'remove', status: 'skipped', reasonCode: 'no_op', targetDraftRevision: 9 },
  ]
  const remainingItems = [originalItems[2]]
  const itemArchive = { ...archiveFor(originalItems), purgeStartedAt: '2026-09-04T11:59:00.000Z' }
  const { payload, updateOne, deleteMany } = harness({
    operations: [operation({ _id: 'op-partial', status: 'completed_with_skips', selectedCount: 3, itemArchive })],
    items: remainingItems,
  })

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result).toEqual({ scannedOperations: 1, compactedOperations: 1, deletedItems: 1, preservedOperations: 0 })
  expect(deleteMany).toHaveBeenCalledWith({ operationId: 'op-partial' })
  expect(updateOne).toHaveBeenCalledWith(
    expect.objectContaining({ _id: 'op-partial', 'itemArchive.sha256': itemArchive.sha256, 'itemArchive.purgeStartedAt': { $exists: true } }),
    { $set: { 'itemArchive.itemsPurgedAt': now.toISOString(), 'itemArchive.purgedItemCount': 3 } },
    retentionWriteOptions,
  )
})

test('keeps partial delete retryable until zero detail rows remain', async () => {
  const originalItems = [
    { curationId: 'cur-1', desiredState: 'remove', status: 'applied', targetDraftRevision: 9 },
    { curationId: 'cur-2', desiredState: 'remove', status: 'applied', targetDraftRevision: 9 },
  ]
  const itemArchive = { ...archiveFor(originalItems), purgeStartedAt: '2026-09-04T11:59:00.000Z' }
  const { payload, updateOne } = harness({
    operations: [operation({ _id: 'op-partial-delete', selectedCount: 2, itemArchive })],
    items: originalItems,
    deletedCount: 1,
  })

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result).toEqual({ scannedOperations: 1, compactedOperations: 0, deletedItems: 1, preservedOperations: 1 })
  expect(updateOne).not.toHaveBeenCalled()
})

test('recovers completion marker after rows were deleted but marker CAS crashed', async () => {
  const originalItems = [{ curationId: 'cur-1', desiredState: 'remove', status: 'applied', targetDraftRevision: 9 }]
  const itemArchive = { ...archiveFor(originalItems), purgeStartedAt: '2026-09-04T11:59:00.000Z' }
  const { payload, updateOne, deleteMany } = harness({ operations: [operation({ _id: 'op-after-delete', itemArchive })], items: [] })

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result).toEqual({ scannedOperations: 1, compactedOperations: 1, deletedItems: 0, preservedOperations: 0 })
  expect(deleteMany).toHaveBeenCalledWith({ operationId: 'op-after-delete' })
  expect(updateOne).toHaveBeenCalledWith(
    expect.objectContaining({ _id: 'op-after-delete', 'itemArchive.sha256': itemArchive.sha256, 'itemArchive.purgeStartedAt': { $exists: true } }),
    { $set: { 'itemArchive.itemsPurgedAt': now.toISOString(), 'itemArchive.purgedItemCount': 1 } },
    retentionWriteOptions,
  )
})

test('never starts purge when persisted archive digest disagrees with untouched detail', async () => {
  const items = [{ curationId: 'cur-1', desiredState: 'remove', status: 'applied', targetDraftRevision: 9 }]
  const itemArchive = { ...archiveFor(items), sha256: '0'.repeat(64) }
  const { payload, updateOne, deleteMany } = harness({ operations: [operation({ _id: 'op-corrupt', itemArchive })], items })

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result.preservedOperations).toBe(1)
  expect(updateOne).not.toHaveBeenCalled()
  expect(deleteMany).not.toHaveBeenCalled()
})

test('marks an originally empty archived failed operation purged so it cannot starve later candidates', async () => {
  const itemArchive = archiveFor([])
  const { payload, updateOne, deleteMany } = harness({
    operations: [operation({ _id: 'op-empty', status: 'failed', selectedCount: 3, itemArchive })],
    items: [],
  })

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result.compactedOperations).toBe(1)
  expect(deleteMany).toHaveBeenCalledWith({ operationId: 'op-empty' })
  expect(updateOne).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ _id: 'op-empty', 'itemArchive.sha256': itemArchive.sha256, 'itemArchive.purgeStartedAt': { $exists: true } }),
    { $set: { 'itemArchive.itemsPurgedAt': now.toISOString(), 'itemArchive.purgedItemCount': 0 } },
    retentionWriteOptions,
  )
})

test('scan excludes aggregate parent operations and includes only unpurged terminal child/single operations', async () => {
  const { payload, operationFind } = harness({ operations: [], items: [] })

  await compactTerminalOperationItems(payload as never, now, { retentionDays: 90, batchSize: 23 })

  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  expect(operationFind).toHaveBeenCalledWith({
    collectionId: { $exists: true, $ne: null },
    jobId: { $exists: true, $ne: null },
    status: { $in: expect.arrayContaining(['completed', 'completed_with_skips', 'failed', 'cancelled', 'conflicted', 'authorization_revoked']) },
    updatedAt: { $lt: cutoff },
    'itemArchive.itemsPurgedAt': { $exists: false },
  })
})