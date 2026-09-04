import { Types } from 'mongoose'
import { expect, test, vi } from 'vitest'
import { purgeOrphanStaging } from '../../../src/jobs/purgeExpiredArtifactsTask'

const now = new Date('2026-09-02T12:00:00.000Z')

function payloadWith(input: {
  staged: Record<string, unknown>[]
  resumable: Record<string, unknown>[]
}) {
  const deleteMany = vi.fn().mockImplementation(async (query: Record<string, unknown>) => {
    const ids = ((query._id as { $in?: unknown[] } | undefined)?.$in ?? [])
    return { deletedCount: ids.length }
  })
  return {
    payload: {
      db: { collections: {
        'collection-draft-changes': {
          find: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(input.staged) }),
            }),
          }),
          deleteMany,
        },
        'collection-operations': {
          find: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(input.resumable) }),
          }),
        },
      } },
    },
    deleteMany,
  }
}

test('deletes only old staged rows whose operation is terminal or missing', async () => {
  const objectId = new Types.ObjectId('65f000000000000000000099')
  const { payload, deleteMany } = payloadWith({
    staged: [
      { _id: objectId, operationId: 'op-terminal' },
      { _id: 'stage-2', operationId: 'op-resumable' },
      { _id: 'stage-3', operationId: 'op-missing' },
    ],
    resumable: [{ _id: 'op-resumable', status: 'committing' }],
  })

  const result = await purgeOrphanStaging(payload as never, now, { retentionDays: 30, batchSize: 100 })

  expect(result).toEqual({ scanned: 3, deleted: 2, preserved: 1 })
  expect(deleteMany).toHaveBeenCalledWith({ _id: { $in: [objectId, 'stage-3'] }, stageState: 'staged' })
})

test('never deletes staging for a nonterminal operation even when the lease is old', async () => {
  const { payload, deleteMany } = payloadWith({
    staged: [{ _id: 'stage-1', operationId: 'op-queued' }],
    resumable: [{ _id: 'op-queued', status: 'queued' }],
  })

  const result = await purgeOrphanStaging(payload as never, now)

  expect(result).toEqual({ scanned: 1, deleted: 0, preserved: 1 })
  expect(deleteMany).not.toHaveBeenCalled()
})
