import { expect, test, vi } from 'vitest'
import { purgeExpiredExports } from '../../../src/jobs/purgeExpiredArtifactsTask'

const now = new Date('2026-09-04T12:00:00.000Z')
const expiredAt = new Date('2026-09-01T12:00:00.000Z')

function harness(rows: Record<string, unknown>[]) {
  const find = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(rows) }),
    }),
  })
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 })
  return {
    payload: { db: { collections: { 'collection-exports': { find, updateOne, deleteOne } } } },
    find, updateOne, deleteOne,
  }
}

test('storage cleanup failure is backed off so one poisoned key cannot monopolize later batches', async () => {
  const { payload, updateOne, deleteOne } = harness([{
    _id: 'export-poisoned', status: 'complete', expiresAt: expiredAt,
    key: 'cms/exports/poisoned.ndjson', cleanupAttempts: 2,
  }])
  const store = { put: vi.fn(), readUrl: vi.fn(), delete: vi.fn().mockRejectedValue(new Error('storage unavailable')) }

  const result = await purgeExpiredExports(payload as never, store as never, now, { batchSize: 100 })

  expect(result).toEqual({ scanned: 1, deleted: 0, preserved: 1 })
  expect(deleteOne).not.toHaveBeenCalled()
  expect(updateOne).toHaveBeenCalledWith(
    expect.objectContaining({
      _id: 'export-poisoned', status: 'complete', expiresAt: { $lte: now },
    }),
    { $set: {
      cleanupAttempts: 3,
      cleanupLastAttemptAt: now,
      cleanupNextAttemptAt: new Date('2026-09-04T16:00:00.000Z'),
    } },
    { timestamps: false },
  )
})

test('cleanup query excludes future backoff before limit and orders only due work', async () => {
  const { payload, find } = harness([])
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
  const query = find.mock.results[0].value
  expect(query.sort).toHaveBeenCalledWith({ cleanupNextAttemptAt: 1, expiresAt: 1, _id: 1 })
})

test('cleanup backoff is exponentially bounded at 24 hours', async () => {
  const { payload, updateOne } = harness([{
    _id: 'export-many-failures', status: 'complete', expiresAt: expiredAt,
    key: 'cms/exports/fails.ndjson', cleanupAttempts: 99,
  }])
  const store = { put: vi.fn(), readUrl: vi.fn(), delete: vi.fn().mockRejectedValue(new Error('still failing')) }

  await purgeExpiredExports(payload as never, store as never, now)

  expect(updateOne).toHaveBeenCalledWith(
    expect.any(Object),
    { $set: expect.objectContaining({
      cleanupAttempts: 100,
      cleanupNextAttemptAt: new Date('2026-09-05T12:00:00.000Z'),
    }) },
    { timestamps: false },
  )
})

test('successful retry still deletes object before the CMS reference', async () => {
  const { payload, deleteOne, updateOne } = harness([{
    _id: 'export-retry-success', status: 'complete', expiresAt: expiredAt,
    key: 'cms/exports/retry.ndjson', cleanupAttempts: 4,
    cleanupNextAttemptAt: new Date('2026-09-04T11:00:00.000Z'),
  }])
  const order: string[] = []
  const store = {
    put: vi.fn(), readUrl: vi.fn(),
    delete: vi.fn().mockImplementation(async () => { order.push('object') }),
  }
  deleteOne.mockImplementation(async () => { order.push('record'); return { deletedCount: 1 } })

  const result = await purgeExpiredExports(payload as never, store as never, now)

  expect(result.deleted).toBe(1)
  expect(order).toEqual(['object', 'record'])
  expect(updateOne).not.toHaveBeenCalled()
})