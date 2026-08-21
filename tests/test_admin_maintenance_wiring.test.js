import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

function text(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Payload maintenance wiring', () => {
  test('registers retention archive manifests and all maintenance tasks', () => {
    const payloadConfig = text('apps/admin/payload.config.ts')
    const collectionIndex = text('apps/admin/src/payload/collections/index.ts')

    expect(collectionIndex).toContain("export { RetentionArchiveManifests } from './RetentionArchiveManifests'")
    expect(payloadConfig).toContain('RetentionArchiveManifests,')
    expect(payloadConfig).toContain('reconcileLeasesTask')
    expect(payloadConfig).toContain('purgeExpiredArtifactsTask')
    expect(payloadConfig).toContain('archiveAuditEventsTask')

    for (const task of [
      'recordWorkerHeartbeat',
      'reconcileLeasesTask',
      'purgeExpiredArtifactsTask',
      'archiveAuditEventsTask',
    ]) {
      expect(payloadConfig).toMatch(new RegExp(`tasks:\\s*\\[[\\s\\S]*${task}`))
    }
  })

  test.each([
    ['reconcileLeasesTask.ts', 'reconcile-leases'],
    ['purgeExpiredArtifactsTask.ts', 'purge-expired-artifacts'],
    ['archiveAuditEventsTask.ts', 'archive-audit-events'],
  ])('%s schedules %s on maintenance queue', (file, slug) => {
    const source = text(`apps/admin/src/jobs/${file}`)
    expect(source).toContain(`slug: '${slug}'`)
    expect(source).toContain("queue: 'maintenance'")
  })
})
