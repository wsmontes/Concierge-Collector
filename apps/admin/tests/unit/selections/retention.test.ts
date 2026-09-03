import { expect, test, vi } from 'vitest'
import { retainSelectionForAudit } from '../../../src/selections/retention'

const now = new Date('2026-09-02T12:00:00.000Z')
const validUntil = new Date('2026-09-03T12:00:00.000Z')
const retainedUntil = new Date('2026-12-01T12:00:00.000Z')

function readyManifest() {
  return { _id: 'selection-1', expiresAt: validUntil }
}

function manifestModel({ validated = readyManifest(), retained = readyManifest() }: { validated?: unknown; retained?: unknown } = {}) {
  return {
    findOne: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(validated) }) }),
    findOneAndUpdate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(retained) }),
  }
}

test('validates, retains items, then CAS-retains the manifest without extending validity', async () => {
  const manifests = manifestModel()
  const itemUpdate = vi.fn().mockResolvedValue({ modifiedCount: 2 })
  const payload = {
    db: { collections: {
      'selection-manifests': manifests,
      'selection-manifest-items': { updateMany: itemUpdate },
    } },
  }

  await retainSelectionForAudit(payload as never, {
    selectionId: 'selection-1',
    actorId: 'admin-1',
    now,
    retainedUntil,
  })

  const predicate = { _id: 'selection-1', actorId: 'admin-1', status: 'ready', expiresAt: { $gt: now } }
  expect(manifests.findOne).toHaveBeenCalledWith(predicate)
  expect(itemUpdate).toHaveBeenCalledWith(
    { selectionId: 'selection-1' },
    { $max: { retainedUntil } },
  )
  expect(manifests.findOneAndUpdate).toHaveBeenCalledWith(
    predicate,
    { $max: { retainedUntil }, $set: { updatedAt: now } },
    { new: true, lean: true },
  )
  expect(JSON.stringify(manifests.findOneAndUpdate.mock.calls[0][1])).not.toContain('expiresAt')
  expect(itemUpdate.mock.invocationCallOrder[0]).toBeLessThan(manifests.findOneAndUpdate.mock.invocationCallOrder[0])
})

test('does not touch items when the manifest is already expired or unauthorized', async () => {
  const itemUpdate = vi.fn()
  const payload = {
    db: { collections: {
      'selection-manifests': manifestModel({ validated: null }),
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

test('a race at the final manifest CAS can only over-retain items and still fails closed', async () => {
  const manifests = manifestModel({ retained: null })
  const itemUpdate = vi.fn().mockResolvedValue({ modifiedCount: 2 })
  const payload = {
    db: { collections: {
      'selection-manifests': manifests,
      'selection-manifest-items': { updateMany: itemUpdate },
    } },
  }

  await expect(retainSelectionForAudit(payload as never, {
    selectionId: 'selection-1', actorId: 'admin-1', now, retainedUntil,
  })).rejects.toMatchObject({ status: 410, code: 'selection_expired' })
  expect(itemUpdate).toHaveBeenCalledTimes(1)
})

test('used retention duration defaults to ninety days and never shortens an existing later retention', async () => {
  const manifests = manifestModel()
  const payload = {
    db: { collections: {
      'selection-manifests': manifests,
      'selection-manifest-items': { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }) },
    } },
  }

  await retainSelectionForAudit(payload as never, { selectionId: 'selection-1', actorId: 'admin-1', now })
  const update = manifests.findOneAndUpdate.mock.calls[0][1] as { $max: { retainedUntil: Date } }
  expect(update.$max.retainedUntil.toISOString()).toBe('2026-12-01T12:00:00.000Z')
})
