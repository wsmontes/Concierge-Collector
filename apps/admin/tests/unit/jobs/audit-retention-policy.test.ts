import { afterEach, expect, test, vi } from 'vitest'
import { archiveAuditEventsTask } from '../../../src/jobs/archiveAuditEventsTask'

const originalDbName = process.env.CMS_MONGODB_DB_NAME
const originalRetention = process.env.CMS_AUDIT_RETENTION_DAYS

afterEach(() => {
  if (originalDbName === undefined) delete process.env.CMS_MONGODB_DB_NAME
  else process.env.CMS_MONGODB_DB_NAME = originalDbName
  if (originalRetention === undefined) delete process.env.CMS_AUDIT_RETENTION_DAYS
  else process.env.CMS_AUDIT_RETENTION_DAYS = originalRetention
})

test('rejects shortened production audit retention before scanning hot events', async () => {
  process.env.CMS_MONGODB_DB_NAME = 'concierge-cms'
  process.env.CMS_AUDIT_RETENTION_DAYS = '30'
  const find = vi.fn()
  const payload = { db: { collections: { 'audit-events': { find } } } }

  await expect((archiveAuditEventsTask.handler as never as (args: unknown) => Promise<unknown>)({
    req: { payload },
  })).rejects.toThrow(/cannot be lower than production minimum 365/)
  expect(find).not.toHaveBeenCalled()
})
