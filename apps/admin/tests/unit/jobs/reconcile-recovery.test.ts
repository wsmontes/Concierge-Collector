import { expect, test, vi } from 'vitest'
import { reconcileRecoverableJobs } from '../../../src/jobs/reconcileLeasesTask'

const now = new Date('2026-09-02T12:00:00.000Z')
const expired = new Date('2026-09-02T11:55:00.000Z')
const stalePayloadUpdatedAt = new Date('2026-09-02T11:50:00.000Z')

function queryModel(rows: Record<string, unknown>[]) {
  return {
    find: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(rows) }),
      }),
    }),
  }
}

test('recovers an exhausted Payload job only when its domain lease is reclaimable', async () => {
  const payloadJob = {
    _id: '65f000000000000000000100',
    processing: false,
    hasError: true,
    completedAt: null,
    totalTried: 3,
    meta: { recoveryCount: 1 },
    updatedAt: stalePayloadUpdatedAt,
  }
  const payloadJobs = {
    findById: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(payloadJob) }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  }
  const payload = {
    db: { collections: {
      'collection-operations': queryModel([{ _id: '65f000000000000000000001', status: 'staging', jobId: payloadJob._id, leaseExpiresAt: expired }]),
      'collection-publish-jobs': queryModel([]),
      'selection-manifests': queryModel([]),
      'collection-exports': queryModel([]),
      'payload-jobs': payloadJobs,
    } },
  }

  const result = await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000, maxRecoveries: 3 })

  expect(result).toEqual({ recovered: 1, healthy: 0, exhausted: 0, missing: 0 })
  expect(payloadJobs.updateOne).toHaveBeenCalledWith(
    { _id: payloadJob._id, hasError: true },
    expect.objectContaining({
      $set: expect.objectContaining({
        processing: false,
        hasError: false,
        completedAt: null,
        totalTried: 0,
        waitUntil: now,
        meta: expect.objectContaining({ recoveryCount: 2 }),
      }),
    }),
  )
})

test('does not disturb a healthy queued Payload job even though the domain lease is empty', async () => {
  const payloadJobs = {
    findById: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({
      _id: '65f000000000000000000101',
      processing: false,
      hasError: false,
      completedAt: null,
      totalTried: 0,
      waitUntil: null,
      meta: null,
      updatedAt: now,
    }) }),
    updateOne: vi.fn(),
  }
  const payload = {
    db: { collections: {
      'collection-operations': queryModel([{ _id: '65f000000000000000000002', status: 'queued', jobId: '65f000000000000000000101', leaseExpiresAt: null }]),
      'collection-publish-jobs': queryModel([]),
      'selection-manifests': queryModel([]),
      'collection-exports': queryModel([]),
      'payload-jobs': payloadJobs,
    } },
  }

  const result = await reconcileRecoverableJobs(payload as never, now)

  expect(result).toEqual({ recovered: 0, healthy: 1, exhausted: 0, missing: 0 })
  expect(payloadJobs.updateOne).not.toHaveBeenCalled()
})

test('recovers processing=true only after both the Payload heartbeat and domain lease are stale', async () => {
  const payloadJobs = {
    findById: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({
      _id: '65f000000000000000000102',
      processing: true,
      hasError: false,
      completedAt: null,
      totalTried: 1,
      meta: {},
      updatedAt: stalePayloadUpdatedAt,
    }) }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  }
  const payload = {
    db: { collections: {
      'collection-operations': queryModel([]),
      'collection-publish-jobs': queryModel([{ _id: '65f000000000000000000010', status: 'running', payloadJobId: '65f000000000000000000102', leaseExpiresAt: expired }]),
      'selection-manifests': queryModel([]),
      'collection-exports': queryModel([]),
      'payload-jobs': payloadJobs,
    } },
  }

  const result = await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })
  expect(result.recovered).toBe(1)
  expect(payloadJobs.updateOne).toHaveBeenCalledTimes(1)
})

test('stops automatic recovery after the bounded recovery count', async () => {
  const payloadJobs = {
    findById: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({
      _id: '65f000000000000000000103',
      processing: false,
      hasError: true,
      completedAt: null,
      totalTried: 3,
      meta: { recoveryCount: 3 },
      updatedAt: stalePayloadUpdatedAt,
    }) }),
    updateOne: vi.fn(),
  }
  const payload = {
    db: { collections: {
      'collection-operations': queryModel([]),
      'collection-publish-jobs': queryModel([]),
      'selection-manifests': queryModel([{ _id: '65f000000000000000000020', status: 'materializing', payloadJobId: '65f000000000000000000103', leaseExpiresAt: expired }]),
      'collection-exports': queryModel([]),
      'payload-jobs': payloadJobs,
    } },
  }

  const result = await reconcileRecoverableJobs(payload as never, now, { maxRecoveries: 3 })
  expect(result).toEqual({ recovered: 0, healthy: 0, exhausted: 1, missing: 0 })
  expect(payloadJobs.updateOne).not.toHaveBeenCalled()
})
