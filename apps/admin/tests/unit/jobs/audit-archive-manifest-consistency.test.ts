import { createHash } from 'node:crypto'
import { expect, test, vi } from 'vitest'
import { archiveAuditEvents } from '../../../src/jobs/archiveAuditEventsTask'

const now = new Date('2026-09-04T12:00:00.000Z')
const events = [{
  _id: 'audit-race-1',
  eventKey: 'event-race-1',
  eventType: 'collection.patch',
  actorId: 'admin-1',
  requestId: 'req-race-1',
  metadata: {},
  createdAt: new Date('2025-01-01T00:00:00Z'),
}]

test('preserves hot audit rows if a concurrent manifest does not match uploaded evidence', async () => {
  const session = {
    withTransaction: vi.fn().mockImplementation(async (callback: () => Promise<unknown>) => callback()),
    endSession: vi.fn().mockResolvedValue(undefined),
  }
  const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 1 })
  const auditUpdateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 })
  const manifestUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, upsertedCount: 0 })
  const findManifest = vi.fn()
    .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(null) })
    .mockReturnValueOnce({
      session: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          batchKey: 'concurrent',
          artifactKey: 'wrong/object.gz',
          contentType: 'application/x-ndjson+gzip',
          sha256: '0'.repeat(64),
          eventCount: 99,
          firstEventId: 'other',
          lastEventId: 'other',
        }),
      }),
    })
  const payload = {
    db: {
      connection: { startSession: vi.fn().mockResolvedValue(session) },
      collections: {
        'audit-events': {
          find: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(events) }),
            }),
          }),
          deleteMany,
          countDocuments: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(0) }),
          updateOne: auditUpdateOne,
        },
        'audit-archive-manifests': {
          findOne: findManifest,
          updateOne: manifestUpdateOne,
        },
      },
    },
  }
  const store = {
    readUrl: vi.fn(), delete: vi.fn(),
    put: vi.fn().mockImplementation(async (request: { key: string; contentType: string; body: AsyncIterable<Uint8Array> }) => {
      const chunks: Uint8Array[] = []
      for await (const chunk of request.body) chunks.push(chunk)
      const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
      return {
        key: `cms/exports/${request.key}`,
        contentType: request.contentType,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }
    }),
  }

  const result = await archiveAuditEvents(payload as never, store as never, now)

  expect(result).toEqual({ scanned: 1, archived: 0, preserved: 1 })
  expect(manifestUpdateOne).toHaveBeenCalledTimes(1)
  expect(findManifest).toHaveBeenCalledTimes(2)
  expect(deleteMany).not.toHaveBeenCalled()
  expect(auditUpdateOne).not.toHaveBeenCalled()
  expect(session.endSession).toHaveBeenCalledTimes(1)
})
