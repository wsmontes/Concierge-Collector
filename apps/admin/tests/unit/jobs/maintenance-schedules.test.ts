import { expect, test } from 'vitest'
import { archiveAuditEventsTask } from '../../../src/jobs/archiveAuditEventsTask'
import { purgeExpiredArtifactsTask } from '../../../src/jobs/purgeExpiredArtifactsTask'

test('retention maintenance drains bounded batches hourly instead of once per day', () => {
  expect(purgeExpiredArtifactsTask.schedule).toEqual([
    expect.objectContaining({ cron: '17 * * * *', queue: 'maintenance' }),
  ])
  expect(archiveAuditEventsTask.schedule).toEqual([
    expect.objectContaining({ cron: '43 * * * *', queue: 'maintenance' }),
  ])
})
