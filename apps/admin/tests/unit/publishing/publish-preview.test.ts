import { expect, test, vi } from 'vitest'
import { getPublishPreview } from '../../../src/publishing/publish-preview'

function asyncRows(rows: Array<Record<string, unknown>>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) yield row
    },
  }
}

function cursorModel(rows: Array<Record<string, unknown>>) {
  return {
    find: vi.fn(() => ({
      sort: vi.fn(() => ({
        cursor: vi.fn(() => asyncRows(rows)),
      })),
    })),
  }
}

test('preview uses published membership plus visible liquid delta without materializing a browser set', async () => {
  const collection = {
    _id: '507f1f77bcf86cd799439011',
    lifecycle: 'published',
    currentPublishedVersion: 2,
    draftEpoch: 'epoch-1',
    draftRevision: 7,
    revision: 12,
    draftState: 'dirty',
  }
  const collections = {
    findById: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(collection) })),
  }
  // Published v2 = c1,c2. Draft removes c2 and adds c3, so final draft = c1,c3.
  const memberships = cursorModel([
    { curationId: 'c1' },
    { curationId: 'c2' },
  ])
  const changes = cursorModel([
    { curationId: 'c2', desiredState: 'remove', targetDraftRevision: 7 },
    { curationId: 'c3', desiredState: 'add', targetDraftRevision: 7 },
  ])
  const payload = {
    db: {
      collections: {
        collections,
        'collection-memberships': memberships,
        'collection-draft-changes': changes,
      },
    },
  }
  const hydrateCurations = vi.fn().mockResolvedValue({ availableCount: 1, unavailableCount: 1 })
  const client = {
    introspectAdmin: vi.fn().mockResolvedValue(undefined),
    hydrateCurations,
  }

  await expect(getPublishPreview(payload as never, {
    collectionId: String(collection._id),
    actorId: 'admin-1',
  }, client)).resolves.toEqual({
    currentPublishedVersion: 2,
    nextVersion: 3,
    draftRevision: 7,
    revision: 12,
    selectedCount: 2,
    availableCount: 1,
    unavailableCount: 1,
    addCount: 1,
    removeCount: 1,
  })

  expect(client.introspectAdmin).toHaveBeenCalledWith('admin-1')
  expect(hydrateCurations).toHaveBeenCalledWith(['c1', 'c3'])
})
