import { Types } from 'mongoose'
import { expect, test, vi } from 'vitest'
import { purgeOrphanStaging } from '../../../src/jobs/purgeExpiredArtifactsTask'

const now = new Date('2026-09-02T12:00:00.000Z')

function payloadWith(eligible: Record<string, unknown>[]) {
  const aggregate = vi.fn().mockResolvedValue(eligible)
  const deleteMany = vi.fn().mockImplementation(async (query: Record<string, unknown>) => {
    const ids = ((query._id as { $in?: unknown[] } | undefined)?.$in ?? [])
    return { deletedCount: ids.length }
  })
  return {
    payload: {
      db: { collections: {
        'collection-draft-changes': { aggregate, deleteMany },
      } },
    },
    aggregate,
    deleteMany,
  }
}

test('deletes the bounded set of staging rows already proven terminal or missing by aggregation', async () => {
  const objectId = new Types.ObjectId('65f000000000000000000099')
  const { payload, deleteMany } = payloadWith([
    { _id: objectId },
    { _id: 'stage-missing-operation' },
  ])

  const result = await purgeOrphanStaging(payload as never, now, { retentionDays: 30, batchSize: 100 })

  expect(result).toEqual({ scanned: 2, deleted: 2, preserved: 0 })
  expect(deleteMany).toHaveBeenCalledWith({
    _id: { $in: [objectId, 'stage-missing-operation'] },
    stageState: 'staged',
  })
})

test('never attempts deletion when no protected row passes the eligibility aggregation', async () => {
  const { payload, deleteMany } = payloadWith([])

  const result = await purgeOrphanStaging(payload as never, now)

  expect(result).toEqual({ scanned: 0, deleted: 0, preserved: 0 })
  expect(deleteMany).not.toHaveBeenCalled()
})
