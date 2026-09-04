import { expect, test, vi } from 'vitest'
import { reconcileRecoverableJobs } from '../../../src/jobs/reconcileLeasesTask'

const now = new Date('2026-09-02T12:00:00.000Z')
const expired = new Date('2026-09-02T11:55:00.000Z')
const futureLease = new Date('2026-09-02T12:05:00.000Z')
const stalePayloadUpdatedAt = new Date('2026-09-02T11:50:00.000Z')

function sourceModel(domain: Record<string, unknown> | null = null, missingRows: Record<string, unknown>[] = []) {
  return {
    findOne: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(domain) }),
    }),
    aggregate: vi.fn().mockResolvedValue(missingRows),
  }
}

function jobsModel(stuckJobs: Record<string, unknown>[], updateOne = vi.fn()) {
  const find = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(stuckJobs) }),
    }),
  })
  return { find, updateOne }
}

function payloadWith(
  source: 'collection-operations' | 'collection-publish-jobs' | 'selection-manifests' | 'collection-exports',
  domain: Record<string, unknown> | null,
  jobs: ReturnType<typeof jobsModel>,
  missingRows: Record<string, unknown>[] = [],
) {
  return { db: { collections: {
    'collection-operations': sourceModel(source === 'collection-operations' ? domain : null, source === 'collection-operations' ? missingRows : []),
    'collection-publish-jobs': sourceModel(source === 'collection-publish-jobs' ? domain : null, source === 'collection-publish-jobs' ? missingRows : []),
    'selection-manifests': sourceModel(source === 'selection-manifests' ? domain : null, source === 'selection-manifests' ? missingRows : []),
    'collection-exports': sourceModel(source === 'collection-exports' ? domain : null, source === 'collection-exports' ? missingRows : []),
    'payload-jobs': jobs,
  } } }
}

test('recovers failed Payload job only when its active domain lease is reclaimable', async () => {
  const job = {
    _id: '65f000000000000000000100', taskSlug: 'apply-draft-operation',
    processing: false, hasError: true, completedAt: null,
    meta: { recoveryCount: 1 }, updatedAt: stalePayloadUpdatedAt,
  }
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const jobs = jobsModel([job], updateOne)
  const payload = payloadWith('collection-operations', {
    _id: '65f000000000000000000001', status: 'staging', jobId: job._id, leaseExpiresAt: expired,
  }, jobs)

  const result = await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000, maxRecoveries: 3 })

  expect(result).toEqual({ recovered: 1, healthy: 0, exhausted: 0, missing: 0 })
  expect(updateOne).toHaveBeenCalledWith(
    { _id: job._id, hasError: true },
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

test('healthy queued Payload jobs are outside the recovery candidate set', async () => {
  const jobs = jobsModel([])
  const payload = payloadWith('collection-operations', null, jobs)

  const result = await reconcileRecoverableJobs(payload as never, now)

  expect(result).toEqual({ recovered: 0, healthy: 0, exhausted: 0, missing: 0 })
  expect(jobs.updateOne).not.toHaveBeenCalled()
})

test('does not reopen a stuck Payload job while the active domain lease is still owned', async () => {
  const job = {
    _id: '65f000000000000000000102', taskSlug: 'publish-collection',
    processing: true, hasError: false, completedAt: null,
    meta: {}, updatedAt: stalePayloadUpdatedAt,
  }
  const updateOne = vi.fn()
  const jobs = jobsModel([job], updateOne)
  const payload = payloadWith('collection-publish-jobs', {
    _id: '65f000000000000000000010', status: 'running', payloadJobId: job._id, leaseExpiresAt: futureLease,
  }, jobs)

  const result = await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })

  expect(result).toEqual({ recovered: 0, healthy: 1, exhausted: 0, missing: 0 })
  expect(updateOne).not.toHaveBeenCalled()
})

test('recovers stale processing Payload job after active domain lease expires', async () => {
  const job = {
    _id: '65f000000000000000000103', taskSlug: 'publish-collection',
    processing: true, hasError: false, completedAt: null,
    meta: {}, updatedAt: stalePayloadUpdatedAt,
  }
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const jobs = jobsModel([job], updateOne)
  const payload = payloadWith('collection-publish-jobs', {
    _id: '65f000000000000000000011', status: 'running', payloadJobId: job._id, leaseExpiresAt: expired,
  }, jobs)

  const result = await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })

  expect(result.recovered).toBe(1)
  expect(updateOne).toHaveBeenCalledWith(
    { _id: job._id, processing: true, updatedAt: { $lte: new Date('2026-09-02T11:58:00.000Z') } },
    expect.any(Object),
  )
})

test('reports active reclaimable domain whose Payload job is missing without reconstructing it', async () => {
  const jobs = jobsModel([])
  const payload = payloadWith('collection-exports', null, jobs, [{ _id: 'export-missing-job' }])

  const result = await reconcileRecoverableJobs(payload as never, now)

  expect(result).toEqual({ recovered: 0, healthy: 0, exhausted: 0, missing: 1 })
  expect(jobs.updateOne).not.toHaveBeenCalled()
})

test('stops automatic recovery after bounded recovery count', async () => {
  const job = {
    _id: '65f000000000000000000104', taskSlug: 'materialize-selection',
    processing: false, hasError: true, completedAt: null,
    meta: { recoveryCount: 3 }, updatedAt: stalePayloadUpdatedAt,
  }
  const updateOne = vi.fn()
  const jobs = jobsModel([job], updateOne)
  const payload = payloadWith('selection-manifests', {
    _id: '65f000000000000000000020', status: 'materializing', payloadJobId: job._id, leaseExpiresAt: expired,
  }, jobs)

  const result = await reconcileRecoverableJobs(payload as never, now, { maxRecoveries: 3 })

  expect(result).toEqual({ recovered: 0, healthy: 0, exhausted: 1, missing: 0 })
  expect(updateOne).not.toHaveBeenCalled()
})

test('stuck-job scan is age ordered and bounded', async () => {
  const jobs = jobsModel([])
  const payload = payloadWith('collection-operations', null, jobs)

  await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })

  const query = jobs.find.mock.calls[0][0]
  expect(query).toEqual(expect.objectContaining({
    'meta.recoveryIgnoredAt': { $exists: false },
    taskSlug: { $in: ['apply-draft-operation', 'publish-collection', 'materialize-selection', 'export-selection'] },
    $or: expect.arrayContaining([
      { hasError: true },
      { completedAt: { $exists: true, $ne: null } },
      { processing: true, updatedAt: { $lte: new Date('2026-09-02T11:58:00.000Z') } },
    ]),
  }))
})