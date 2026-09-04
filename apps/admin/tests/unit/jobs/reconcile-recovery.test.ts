import { expect, test, vi } from 'vitest'
import { reconcileRecoverableJobs } from '../../../src/jobs/reconcileLeasesTask'

const now = new Date('2026-09-02T12:00:00.000Z')
const expired = new Date('2026-09-02T11:55:00.000Z')
const stalePayloadUpdatedAt = new Date('2026-09-02T11:50:00.000Z')

function queryModel(rows: Record<string, unknown>[]) {
  const lean = vi.fn().mockResolvedValue(rows)
  const limit = vi.fn().mockReturnValue({ lean })
  const select = vi.fn().mockReturnValue({ limit })
  const sort = vi.fn().mockReturnValue({ select })
  const find = vi.fn().mockReturnValue({ sort })
  const findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) })
  return { find, findOne, sort, select, limit, lean }
}

function payloadJobsModel(job: Record<string, unknown> | null, updateOne = vi.fn()) {
  return {
    findById: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(job) }),
    // Terminal-success cleanup is a separate bounded scan. These focused tests
    // exercise the active-domain path, so there are no terminal leftovers.
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    updateOne,
  }
}

function payloadWith(source: string, rows: Record<string, unknown>[], payloadJobs: ReturnType<typeof payloadJobsModel>) {
  return {
    db: { collections: {
      'collection-operations': queryModel(source === 'collection-operations' ? rows : []),
      'collection-publish-jobs': queryModel(source === 'collection-publish-jobs' ? rows : []),
      'selection-manifests': queryModel(source === 'selection-manifests' ? rows : []),
      'collection-exports': queryModel(source === 'collection-exports' ? rows : []),
      'payload-jobs': payloadJobs,
    } },
  }
}

test('recovers an exhausted Payload job only when its active domain lease is reclaimable', async () => {
  const payloadJob = {
    _id: '65f000000000000000000100',
    processing: false,
    hasError: true,
    completedAt: null,
    totalTried: 3,
    meta: { recoveryCount: 1 },
    updatedAt: stalePayloadUpdatedAt,
  }
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const payloadJobs = payloadJobsModel(payloadJob, updateOne)
  const payload = payloadWith('collection-operations', [
    { _id: '65f000000000000000000001', status: 'staging', jobId: payloadJob._id, leaseExpiresAt: expired, updatedAt: expired },
  ], payloadJobs)

  const result = await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000, maxRecoveries: 3 })

  expect(result).toEqual({ recovered: 1, healthy: 0, exhausted: 0, missing: 0 })
  expect(updateOne).toHaveBeenCalledWith(
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
  const job = {
    _id: '65f000000000000000000101',
    processing: false,
    hasError: false,
    completedAt: null,
    totalTried: 0,
    waitUntil: null,
    meta: null,
    updatedAt: now,
  }
  const updateOne = vi.fn()
  const payloadJobs = payloadJobsModel(job, updateOne)
  const payload = payloadWith('collection-operations', [
    { _id: '65f000000000000000000002', status: 'queued', jobId: job._id, leaseExpiresAt: null, updatedAt: now },
  ], payloadJobs)

  const result = await reconcileRecoverableJobs(payload as never, now)

  expect(result).toEqual({ recovered: 0, healthy: 1, exhausted: 0, missing: 0 })
  expect(updateOne).not.toHaveBeenCalled()
})

test('recovers processing=true only after both the Payload heartbeat and domain lease are stale', async () => {
  const job = {
    _id: '65f000000000000000000102',
    processing: true,
    hasError: false,
    completedAt: null,
    totalTried: 1,
    meta: {},
    updatedAt: stalePayloadUpdatedAt,
  }
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const payloadJobs = payloadJobsModel(job, updateOne)
  const payload = payloadWith('collection-publish-jobs', [
    { _id: '65f000000000000000000010', status: 'running', payloadJobId: job._id, leaseExpiresAt: expired, updatedAt: expired },
  ], payloadJobs)

  const result = await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })
  expect(result.recovered).toBe(1)
  expect(updateOne).toHaveBeenCalledTimes(1)
})

test('reports a missing Payload job as corruption while domain intent is active', async () => {
  const payloadJobs = payloadJobsModel(null)
  const payload = payloadWith('collection-exports', [
    { _id: 'export-running', status: 'running', payloadJobId: 'payload-missing', leaseExpiresAt: expired, updatedAt: expired },
  ], payloadJobs)

  const result = await reconcileRecoverableJobs(payload as never, now)

  expect(result).toEqual({ recovered: 0, healthy: 0, exhausted: 0, missing: 1 })
})

test('stops automatic recovery after the bounded recovery count', async () => {
  const job = {
    _id: '65f000000000000000000103',
    processing: false,
    hasError: true,
    completedAt: null,
    totalTried: 3,
    meta: { recoveryCount: 3 },
    updatedAt: stalePayloadUpdatedAt,
  }
  const updateOne = vi.fn()
  const payloadJobs = payloadJobsModel(job, updateOne)
  const payload = payloadWith('selection-manifests', [
    { _id: '65f000000000000000000020', status: 'materializing', payloadJobId: job._id, leaseExpiresAt: expired, updatedAt: expired },
  ], payloadJobs)

  const result = await reconcileRecoverableJobs(payload as never, now, { maxRecoveries: 3 })
  expect(result).toEqual({ recovered: 0, healthy: 0, exhausted: 1, missing: 0 })
  expect(updateOne).not.toHaveBeenCalled()
})

test('active-domain scans are age ordered and bounded so old healthy rows cannot starve stuck work forever', async () => {
  const job = {
    _id: 'job-healthy', processing: false, hasError: false, completedAt: null, updatedAt: now,
  }
  const payloadJobs = payloadJobsModel(job)
  const operations = queryModel([])
  const payload = {
    db: { collections: {
      'collection-operations': operations,
      'collection-publish-jobs': queryModel([]),
      'selection-manifests': queryModel([]),
      'collection-exports': queryModel([]),
      'payload-jobs': payloadJobs,
    } },
  }

  await reconcileRecoverableJobs(payload as never, now)

  expect(operations.sort).toHaveBeenCalledWith({ updatedAt: 1, _id: 1 })
  expect(operations.limit).toHaveBeenCalledWith(200)
})
