import { createHash } from 'node:crypto'
import { expect, test, vi } from 'vitest'
import { compactTerminalOperationItems } from '../../../src/jobs/operation-item-retention'

const now = new Date('2026-09-04T12:00:00.000Z')
const old = new Date('2026-05-01T12:00:00.000Z')

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

function harness(input: {
  operations: Record<string, unknown>[]
  items: Record<string, unknown>[]
  persist?: boolean
  deleteFails?: boolean
  deletedCount?: number
}) {
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: input.persist === false ? 0 : 1 })
  const deleteMany = vi.fn().mockImplementation(async () => {
    if (input.deleteFails) throw new Error('delete failed')
    return { deletedCount: input.deletedCount ?? input.items.length }
  })
  const operationFind = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(input.operations) }) }),
  })
  const itemFind = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(input.items) }),
  })
  return {
    payload: { db: { collections: {
      'collection-operations': { find: operationFind, updateOne },
      'collection-operation-items': { find: itemFind, deleteMany },
    } } },
    operationFind,
    updateOne,
    deleteMany,
  }
}

test('compacts old terminal operation items into deterministic summary before deletion', async () => {
  const items = [
    { curationId: 'cur-1', desiredState: 'add', status: 'applied', reasonCode: null, targetDraftRevision: 7 },
    { curationId: 'cur-2', desiredState: 'add', status: 'skipped', reasonCode: 'unavailable', targetDraftRevision: 7 },
    { curationId: 'cur-3', desiredState: 'add', status: 'skipped', reasonCode: 'unavailable', targetDraftRevision: 7 },
  ]
  const { payload, updateOne, deleteMany } = harness({
    operations: [{ _id: 'op-1', status: 'completed_with_skips', updatedAt: old }],
    items,
  })

  const result = await compactTerminalOperationItems(payload as never, now, { retentionDays: 90, batchSize: 10 })

  const expectedSha = createHash('sha256').update(canonical(items)).digest('hex')
  expect(result).toEqual({ scannedOperations: 1, compactedOperations: 1, deletedItems: 3, preservedOperations: 0 })
  expect(updateOne).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ _id: 'op-1', status: 'completed_with_skips', itemArchive: { $exists: false } }),
    { $set: { itemArchive: expect.objectContaining({
      itemCount: 3,
      statusCounts: { applied: 1, skipped: 2 },
      reasonCounts: { unavailable: 2 },
      sha256: expectedSha,
    }) } },
  )
  expect(updateOne.mock.invocationCallOrder[0]).toBeLessThan(deleteMany.mock.invocationCallOrder[0])
  expect(updateOne).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ _id: 'op-1', 'itemArchive.sha256': expectedSha }),
    { $set: { 'itemArchive.itemsPurgedAt': now.toISOString(), 'itemArchive.purgedItemCount': 3 } },
  )
})

test('does not delete item rows if parent summary CAS is not persisted', async () => {
  const { payload, deleteMany } = harness({
    operations: [{ _id: 'op-2', status: 'completed', updatedAt: old }],
    items: [{ curationId: 'cur-1', desiredState: 'remove', status: 'applied', targetDraftRevision: 9 }],
    persist: false,
  })

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result.preservedOperations).toBe(1)
  expect(deleteMany).not.toHaveBeenCalled()
})

test('keeps an archived parent retryable when item deletion fails', async () => {
  const items = [{ curationId: 'cur-1', desiredState: 'remove', status: 'applied', targetDraftRevision: 9 }]
  const itemArchive = archiveFor(items)
  const { payload, updateOne, deleteMany } = harness({
    operations: [{ _id: 'op-retry', status: 'completed', updatedAt: old, itemArchive }],
    items,
    deleteFails: true,
  })

  const first = await compactTerminalOperationItems(payload as never, now)

  expect(first).toEqual({ scannedOperations: 1, compactedOperations: 0, deletedItems: 0, preservedOperations: 1 })
  expect(updateOne).not.toHaveBeenCalled()
  expect(deleteMany).toHaveBeenCalledTimes(1)
})

test('rerun reuses the persisted archive and retries deletion without changing its digest', async () => {
  const items = [{ curationId: 'cur-1', desiredState: 'remove', status: 'applied', targetDraftRevision: 9 }]
  const itemArchive = archiveFor(items)
  const { payload, updateOne, deleteMany } = harness({
    operations: [{ _id: 'op-retry', status: 'completed', updatedAt: old, itemArchive }],
    items,
  })

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result).toEqual({ scannedOperations: 1, compactedOperations: 1, deletedItems: 1, preservedOperations: 0 })
  expect(deleteMany).toHaveBeenCalledWith({ operationId: 'op-retry' })
  expect(updateOne).toHaveBeenCalledTimes(1)
  expect(updateOne).toHaveBeenCalledWith(
    expect.objectContaining({ _id: 'op-retry', 'itemArchive.sha256': itemArchive.sha256 }),
    { $set: { 'itemArchive.itemsPurgedAt': now.toISOString(), 'itemArchive.purgedItemCount': 1 } },
  )
})

test('never deletes rows when persisted archive digest does not match remaining detail', async () => {
  const items = [{ curationId: 'cur-1', desiredState: 'remove', status: 'applied', targetDraftRevision: 9 }]
  const itemArchive = { ...archiveFor(items), sha256: '0'.repeat(64) }
  const { payload, deleteMany } = harness({
    operations: [{ _id: 'op-corrupt', status: 'completed', updatedAt: old, itemArchive }],
    items,
  })

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result.preservedOperations).toBe(1)
  expect(deleteMany).not.toHaveBeenCalled()
})

test('marks an already-empty archived operation purged so it cannot starve later scan candidates', async () => {
  const itemArchive = archiveFor([])
  const { payload, updateOne, deleteMany } = harness({
    operations: [{ _id: 'op-empty', status: 'completed', updatedAt: old, itemArchive }],
    items: [],
  })

  const result = await compactTerminalOperationItems(payload as never, now)

  expect(result.compactedOperations).toBe(1)
  expect(deleteMany).not.toHaveBeenCalled()
  expect(updateOne).toHaveBeenCalledWith(
    expect.objectContaining({ _id: 'op-empty', 'itemArchive.sha256': itemArchive.sha256 }),
    { $set: { 'itemArchive.itemsPurgedAt': now.toISOString(), 'itemArchive.purgedItemCount': 0 } },
  )
})

test('scan includes only old terminal operations whose item purge is not complete', async () => {
  const { payload, operationFind } = harness({ operations: [], items: [] })

  await compactTerminalOperationItems(payload as never, now, { retentionDays: 90, batchSize: 23 })

  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  expect(operationFind).toHaveBeenCalledWith({
    status: { $in: expect.arrayContaining(['completed', 'completed_with_skips', 'failed', 'cancelled', 'conflicted', 'authorization_revoked']) },
    updatedAt: { $lt: cutoff },
    'itemArchive.itemsPurgedAt': { $exists: false },
  })
})
