import { expect, test, vi } from 'vitest'
import { retainSelectionForAudit } from '../../../src/selections/retention'

const now = new Date('2026-09-02T12:00:00.000Z')
const validUntil = new Date('2026-09-03T12:00:00.000Z')
const retainedUntil = new Date('2026-12-01T12:00:00.000Z')

test('extends retention for a ready unexpired manifest and all of its items without extending validity', async () => {
  const manifestUpdate = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'selection-1' }) })
  const itemUpdate = vi.fn().mockResolvedValue({ modifiedCount: 2 })
  const payload = {
    db: { collections: {
      'selection-manifests': { findOneAndUpdate: manifestUpdate },
      'selection-manifest-items': { updateMany: itemUpdate },
    } },
  }

  await retainSelectionForAudit(payload as never, {
    selectionId: 'selection-1',
    actorId: 'admin-1',
    now,
    retainedUntil,
  })

  expect(manifestUpdate).toHaveBeenCalledWith(
    { _id: 'selection-1', actorId: 'admin-1', status: 'ready', expiresAt: { $gt: now } },
    { $max: { retainedUntil }, $set: { updatedAt: now } },
    { new: true, lean: true },
  )
  expect(itemUpdate).toHaveBeenCalledWith(
    { selectionId: 'selection-1' },
    { $max: { retainedUntil } },
  )
  expect(JSON.stringify(manifestUpdate.mock.calls[0][1])).not.toContain('expiresAt')
})

test('fails rather than resurrecting an expired or unauthorized manifest', async () => {
  const itemUpdate = vi.fn()
  const payload = {
    db: { collections: {
      'selection-manifests': { findOneAndUpdate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) },
      'selection-manifest-items': { updateMany: itemUpdate },
    } },
  }

  await expect(retainSelectionForAudit(payload as never, {
    selectionId: 'selection-1',
    actorId: 'admin-1',
    now,
    retainedUntil,
  })).rejects.toMatchObject({ status: 410, code: 'selection_expired' })
  expect(itemUpdate).not.toHaveBeenCalled()
})

test('used retention duration defaults to ninety days and never shortens an existing later retention', async () => {
  const manifestUpdate = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'selection-1', expiresAt: validUntil }) })
  const payload = {
    db: { collections: {
      'selection-manifests': { findOneAndUpdate: manifestUpdate },
      'selection-manifest-items': { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }) },
    } },
  }

  await retainSelectionForAudit(payload as never, { selectionId: 'selection-1', actorId: 'admin-1', now })
  const update = manifestUpdate.mock.calls[0][1] as { $max: { retainedUntil: Date } }
  expect(update.$max.retainedUntil.toISOString()).toBe('2026-12-01T12:00:00.000Z')
})
