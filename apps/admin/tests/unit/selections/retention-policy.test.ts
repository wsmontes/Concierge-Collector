import { afterEach, expect, test, vi } from 'vitest'
import { retainSelectionForAudit } from '../../../src/selections/retention'

const originalDbName = process.env.CMS_MONGODB_DB_NAME
const originalRetention = process.env.CMS_USED_SELECTION_RETENTION_DAYS

afterEach(() => {
  if (originalDbName === undefined) delete process.env.CMS_MONGODB_DB_NAME
  else process.env.CMS_MONGODB_DB_NAME = originalDbName
  if (originalRetention === undefined) delete process.env.CMS_USED_SELECTION_RETENTION_DAYS
  else process.env.CMS_USED_SELECTION_RETENTION_DAYS = originalRetention
})

test('rejects shortened production used-selection retention before mutating manifest or items', async () => {
  process.env.CMS_MONGODB_DB_NAME = 'concierge-cms'
  process.env.CMS_USED_SELECTION_RETENTION_DAYS = '7'
  const findOne = vi.fn()
  const updateMany = vi.fn()
  const payload = {
    db: { collections: {
      'selection-manifests': { findOne },
      'selection-manifest-items': { updateMany },
    } },
  }

  await expect(retainSelectionForAudit(payload as never, {
    selectionId: 'selection-1', actorId: 'admin-1', now: new Date('2026-09-04T12:00:00Z'),
  })).rejects.toThrow(/cannot be lower than production minimum 90/)
  expect(findOne).not.toHaveBeenCalled()
  expect(updateMany).not.toHaveBeenCalled()
})
