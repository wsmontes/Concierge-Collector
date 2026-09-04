import { gunzipSync } from 'node:zlib'
import { expect, test, vi } from 'vitest'
import { archiveAuditEvents } from '../../../src/jobs/archiveAuditEventsTask'

const now = new Date('2026-09-04T12:00:00.000Z')

function chain<T>(value: T) {
  return {
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }),
    }),
  }
}

function harness(events: Record<string, unknown>[], options: { manifestFails?: boolean; uploadFails?: boolean } = {}) {
  const order: string[] = []
  const auditUpdateOne = vi.fn().mockImplementation(async () => { order.push('completion-event'); return { upsertedCount: 1 } })
  const manifestUpdateOne = vi.fn().mockImplementation(async () => {
    order.push('manifest')
    if (options.manifestFails) throw new Error('manifest failed')
    return { upsertedCount: 1 }
  })
  const deleteMany = vi.fn().mockImplementation(async () => { order.push('delete-source'); return { deletedCount: events.length } })
  const payload = {
    db: { collections: {
      'audit-events': {
        find: vi.fn().mockReturnValue(chain(events)),
        updateOne: auditUpdateOne,
        deleteMany,
      },
      'audit-archive-manifests': {
        findOne: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
        updateOne: manifestUpdateOne,
      },
    } },
  }
  const uploaded: Uint8Array[] = []
  const store = {
    readUrl: vi.fn(), delete: vi.fn(),
    put: vi.fn().mockImplementation(async (request: { key: string; body: AsyncIterable<Uint8Array> }) => {
      order.push('upload')
      if (options.uploadFails) throw new Error('upload failed')
      for await (const chunk of request.body) uploaded.push(chunk)
      return { key: `cms/exports/${request.key}`, contentType: 'application/x-ndjson+gzip', sha256: 'storage-sha' }
    }),
  }
  return { payload, store, order, uploaded, manifestUpdateOne, deleteMany, auditUpdateOne }
}

const oldEvents = [
  {
    _id: 'audit-1', eventKey: 'event-1', eventType: 'collection.patch', actorId: 'admin-1', requestId: 'req-1',
    collectionId: 'col-1', metadata: { b: 2, a: 1 }, createdAt: new Date('2025-01-01T00:00:00Z'),
  },
  {
    _id: 'audit-2', eventKey: 'event-2', eventType: 'collection.publish', actorId: 'admin-1', requestId: 'req-2',
    collectionId: 'col-1', metadata: { version: 3 }, createdAt: new Date('2025-01-02T00:00:00Z'),
  },
]

test('uploads deterministic gzip, persists manifest, then deletes source and emits completion audit', async () => {
  const { payload, store, order, uploaded, manifestUpdateOne, deleteMany } = harness(oldEvents)

  const result = await archiveAuditEvents(payload as never, store as never, now, { retentionDays: 365, batchSize: 100 })

  expect(result).toMatchObject({ scanned: 2, archived: 2, preserved: 0 })
  expect(order).toEqual(['upload', 'manifest', 'delete-source', 'completion-event'])
  expect(deleteMany).toHaveBeenCalledWith({ _id: { $in: ['audit-1', 'audit-2'] } })
  expect(manifestUpdateOne).toHaveBeenCalledWith(
    expect.objectContaining({ batchKey: expect.any(String) }),
    { $setOnInsert: expect.objectContaining({ eventCount: 2, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }) },
    { upsert: true },
  )

  const ndjson = gunzipSync(Buffer.concat(uploaded.map((chunk) => Buffer.from(chunk)))).toString('utf8')
  const lines = ndjson.trim().split('\n').map((line) => JSON.parse(line))
  expect(lines).toEqual([
    expect.objectContaining({ id: 'audit-1', eventKey: 'event-1', eventType: 'collection.patch' }),
    expect.objectContaining({ id: 'audit-2', eventKey: 'event-2', eventType: 'collection.publish' }),
  ])
})

test('preserves all source events if private upload fails', async () => {
  const { payload, store, manifestUpdateOne, deleteMany, auditUpdateOne } = harness(oldEvents, { uploadFails: true })

  const result = await archiveAuditEvents(payload as never, store as never, now)

  expect(result).toEqual({ scanned: 2, archived: 0, preserved: 2 })
  expect(manifestUpdateOne).not.toHaveBeenCalled()
  expect(deleteMany).not.toHaveBeenCalled()
  expect(auditUpdateOne).not.toHaveBeenCalled()
})

test('preserves source events if archive manifest cannot be persisted', async () => {
  const { payload, store, deleteMany, auditUpdateOne } = harness(oldEvents, { manifestFails: true })

  const result = await archiveAuditEvents(payload as never, store as never, now)

  expect(result).toEqual({ scanned: 2, archived: 0, preserved: 2 })
  expect(deleteMany).not.toHaveBeenCalled()
  expect(auditUpdateOne).not.toHaveBeenCalled()
})

test('selects only events older than the hot-retention cutoff in bounded order', async () => {
  const { payload, store } = harness([])

  await archiveAuditEvents(payload as never, store as never, now, { retentionDays: 365, batchSize: 37 })

  const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
  expect(payload.db.collections['audit-events'].find).toHaveBeenCalledWith({ createdAt: { $lt: cutoff } })
})
