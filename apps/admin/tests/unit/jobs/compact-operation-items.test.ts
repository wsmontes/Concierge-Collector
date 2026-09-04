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
  })).join('\n') + '\n'
}

function harness(input: { operations: Record<string, unknown>[]; items: Record<string, unknown>[]; persist?: boolean }) {
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: input.persist === false ? 0 : 1 })
  const deleteMany = vi.fn().mockResolvedValue({ deletedCount: input.items.length })
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
  expect(updateOne).toHaveBeenCalledWith(
    expect.objectContaining({ _id: 'op-1', status: 'completed_with_skips', itemArchive: { $exists: false } }),
    { $set: { itemArchive: expect.objectContaining({
      itemCount: 3,
      statusCounts: { applied: 1, skipped: 2 },
      reasonCounts: { unavailable: 2 },
      sha256: expectedSha,
    }) } },
  )
  expect(updateOne.mock.invocationCallOrder[0]).toBeLessThan(deleteMany.mock.invocationCallOrder[0])
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

test('scan is restricted to old terminal operations without an existing archive', async () => {
  const { payload, operationFind } = harness({ operations: [], items: [] })

  await compactTerminalOperationItems(payload as never, now, { retentionDays: 90, batchSize: 23 })

  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  expect(operationFind).toHaveBeenCalledWith({
    status: { $in: expect.arrayContaining(['completed', 'completed_with_skips', 'failed', 'cancelled', 'conflicted', 'authorization_revoked']) },
    updatedAt: { $lt: cutoff },
    itemArchive: { $exists: false },
  })
})
