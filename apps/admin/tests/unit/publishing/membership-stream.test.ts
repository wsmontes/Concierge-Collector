import { describe, expect, test } from 'vitest'
import { inspectAvailability, streamDraftMembershipIds } from '../../../src/publishing/membership-stream'

function asyncRows(rows: Record<string, unknown>[]) {
  return {
    find: () => ({
      sort: () => ({
        cursor: async function* () { yield* rows },
      }),
    }),
  } as never
}

describe('publish membership stream', () => {
  test('merges current intervals with only the latest visible liquid delta', async () => {
    const ids: string[] = []
    for await (const id of streamDraftMembershipIds({
      memberships: asyncRows([{ curationId: 'c1' }, { curationId: 'c3' }]),
      changes: asyncRows([
        { curationId: 'c2', desiredState: 'add', targetDraftRevision: 2 },
        { curationId: 'c3', desiredState: 'remove', targetDraftRevision: 2 },
        { curationId: 'c4', desiredState: 'add', targetDraftRevision: 2 },
        { curationId: 'c4', desiredState: 'remove', targetDraftRevision: 1 },
      ]),
      collectionId: 'collection', baseVersion: 1, draftEpoch: 'epoch', draftRevision: 2,
    })) ids.push(id)

    expect(ids).toEqual(['c1', 'c2', 'c4'])
  })

  test('hydrates a large stream in bounded batches without retaining IDs', async () => {
    async function* ids() { for (let index = 0; index < 1_001; index += 1) yield `c${index}` }
    const sizes: number[] = []
    const result = await inspectAvailability(ids(), async (batch) => {
      sizes.push(batch.length)
      return { availableCount: batch.length, unavailableCount: 0 }
    })

    expect(sizes).toEqual([500, 500, 1])
    expect(result).toEqual({ selectedCount: 1_001, availableCount: 1_001, unavailableCount: 0 })
  })
})
