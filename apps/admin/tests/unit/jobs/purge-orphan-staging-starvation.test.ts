import { expect, test, vi } from 'vitest'
import { purgeOrphanStaging } from '../../../src/jobs/purgeExpiredArtifactsTask'

const now = new Date('2026-09-04T12:00:00.000Z')

function harness(candidates: Record<string, unknown>[]) {
  const aggregate = vi.fn().mockResolvedValue(candidates)
  const deleteMany = vi.fn().mockImplementation(async (query: Record<string, unknown>) => ({
    deletedCount: ((query._id as { $in?: unknown[] })?.$in ?? []).length,
  }))
  return {
    payload: {
      db: { collections: {
        'collection-draft-changes': { aggregate, deleteMany },
        'collection-operations': {},
      } },
    },
    aggregate,
    deleteMany,
  }
}

test('filters protected nonterminal operations before applying the cleanup batch limit', async () => {
  const { payload, aggregate, deleteMany } = harness([
    { _id: 'eligible-terminal' },
    { _id: 'eligible-missing' },
  ])

  const result = await purgeOrphanStaging(payload as never, now, { retentionDays: 30, batchSize: 2 })

  expect(result).toEqual({ scanned: 2, deleted: 2, preserved: 0 })
  const pipeline = aggregate.mock.calls[0][0] as Record<string, unknown>[]
  const lookupIndex = pipeline.findIndex((stage) => '$lookup' in stage)
  const eligibilityIndex = pipeline.findIndex((stage, index) => index > lookupIndex && '$match' in stage)
  const limitIndex = pipeline.findIndex((stage) => '$limit' in stage)

  expect(lookupIndex).toBeGreaterThanOrEqual(0)
  expect(eligibilityIndex).toBeGreaterThan(lookupIndex)
  expect(limitIndex).toBeGreaterThan(eligibilityIndex)
  expect(pipeline[lookupIndex]).toEqual({
    $lookup: {
      from: 'collection_operations',
      localField: 'operationId',
      foreignField: '_id',
      as: '_retentionOperation',
    },
  })
  expect(pipeline[eligibilityIndex]).toEqual({
    $match: {
      $or: [
        { '_retentionOperation.0': { $exists: false } },
        { '_retentionOperation.0.status': { $in: expect.arrayContaining(['completed', 'failed', 'cancelled']) } },
      ],
    },
  })
  expect(pipeline[limitIndex]).toEqual({ $limit: 2 })
  expect(deleteMany).toHaveBeenCalledWith({
    _id: { $in: ['eligible-terminal', 'eligible-missing'] },
    stageState: 'staged',
  })
})

test('does no destructive write when aggregation finds no eligible staging rows', async () => {
  const { payload, deleteMany } = harness([])

  const result = await purgeOrphanStaging(payload as never, now, { retentionDays: 30, batchSize: 500 })

  expect(result).toEqual({ scanned: 0, deleted: 0, preserved: 0 })
  expect(deleteMany).not.toHaveBeenCalled()
})
