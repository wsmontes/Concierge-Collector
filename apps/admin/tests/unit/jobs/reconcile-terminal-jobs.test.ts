import { expect, test, vi } from 'vitest'
import { reconcileRecoverableJobs } from '../../../src/jobs/reconcileLeasesTask'

const now = new Date('2026-09-02T12:00:00.000Z')
const stale = new Date('2026-09-02T11:50:00.000Z')

function sourceModel(domain: Record<string, unknown> | null = null) {
  return {
    findOne: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(domain) }),
    }),
    aggregate: vi.fn().mockResolvedValue([]),
  }
}

function jobsModel(stuckJobs: Record<string, unknown>[]) {
  const find = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(stuckJobs) }),
    }),
  })
  return { find, updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }) }
}

function payloadFor(
  source: 'collection-operations' | 'collection-publish-jobs' | 'selection-manifests' | 'collection-exports',
  domain: Record<string, unknown> | null,
  jobs: ReturnType<typeof jobsModel>,
) {
  return { db: { collections: {
    'collection-operations': sourceModel(source === 'collection-operations' ? domain : null),
    'collection-publish-jobs': sourceModel(source === 'collection-publish-jobs' ? domain : null),
    'selection-manifests': sourceModel(source === 'selection-manifests' ? domain : null),
    'collection-exports': sourceModel(source === 'collection-exports' ? domain : null),
    'payload-jobs': jobs,
  } } }
}

test('reopens stale Payload job after durable domain success so Payload can finish cleanup', async () => {
  const job = {
    _id: 'payload-terminal-1', taskSlug: 'publish-collection', processing: true,
    hasError: false, completedAt: null, updatedAt: stale, meta: {},
  }
  const jobs = jobsModel([job])
  const payload = payloadFor('collection-publish-jobs', {
    _id: 'publish-domain-1', payloadJobId: job._id, status: 'completed', leaseExpiresAt: null,
  }, jobs)

  const result = await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000, maxRecoveries: 3 })

  expect(result.recovered).toBe(1)
  expect(jobs.updateOne).toHaveBeenCalledWith(
    { _id: job._id, processing: true, updatedAt: { $lte: new Date('2026-09-02T11:58:00.000Z') } },
    expect.objectContaining({
      $set: expect.objectContaining({
        processing: false,
        hasError: false,
        completedAt: null,
        waitUntil: now,
        meta: expect.objectContaining({ recoveredAfterDomainSuccess: true }),
      }),
    }),
  )
})

test('reopens completedAt leftover after domain success because completed jobs are otherwise invisible to runner', async () => {
  const job = {
    _id: 'payload-completed-leftover', taskSlug: 'export-selection', processing: false,
    hasError: false, completedAt: stale, updatedAt: stale, meta: {},
  }
  const jobs = jobsModel([job])
  const payload = payloadFor('collection-exports', {
    _id: 'export-complete', payloadJobId: job._id, status: 'complete', leaseExpiresAt: null,
  }, jobs)

  const result = await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })

  expect(result.recovered).toBe(1)
  expect(jobs.updateOne).toHaveBeenCalledWith(
    { _id: job._id, completedAt: { $ne: null } },
    expect.objectContaining({ $set: expect.objectContaining({ completedAt: null, processing: false }) }),
  )
})

test('failed terminal domain job remains stored but is classified out of future automatic recovery scans', async () => {
  const job = {
    _id: 'payload-failed-domain', taskSlug: 'export-selection', processing: false,
    hasError: true, completedAt: null, updatedAt: stale, meta: {},
  }
  const jobs = jobsModel([job])
  const payload = payloadFor('collection-exports', {
    _id: 'export-failed', payloadJobId: job._id, status: 'failed', leaseExpiresAt: null,
  }, jobs)

  const result = await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })

  expect(result.recovered).toBe(0)
  expect(jobs.updateOne).toHaveBeenCalledWith(
    { _id: job._id, hasError: true, 'meta.recoveryIgnoredAt': { $exists: false } },
    { $set: expect.objectContaining({
      'meta.recoveryIgnoredAt': now.toISOString(),
      'meta.recoveryIgnoredReason': 'domain_terminal_failure',
      'meta.recoveryIgnoredDomainStatus': 'failed',
    }) },
  )
})

test('orphaned domain-task job with no domain record is classified instead of rebuilt or retried forever', async () => {
  const job = {
    _id: 'payload-orphan', taskSlug: 'materialize-selection', processing: false,
    hasError: true, completedAt: null, updatedAt: stale, meta: {},
  }
  const jobs = jobsModel([job])
  const payload = payloadFor('selection-manifests', null, jobs)

  await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })

  expect(jobs.updateOne).toHaveBeenCalledWith(
    { _id: job._id, hasError: true, 'meta.recoveryIgnoredAt': { $exists: false } },
    { $set: expect.objectContaining({
      'meta.recoveryIgnoredReason': 'domain_missing',
      'meta.recoveryIgnoredDomainStatus': null,
    }) },
  )
})

test('stuck-job scan is bounded, age ordered, domain-task-only, and excludes classified jobs before limit', async () => {
  const jobs = jobsModel([])
  const payload = payloadFor('collection-operations', null, jobs)

  await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })

  expect(jobs.find).toHaveBeenCalledWith(expect.objectContaining({
    taskSlug: { $in: ['apply-draft-operation', 'publish-collection', 'materialize-selection', 'export-selection'] },
    'meta.recoveryIgnoredAt': { $exists: false },
    $or: expect.arrayContaining([
      { hasError: true },
      { completedAt: { $exists: true, $ne: null } },
      { processing: true, updatedAt: { $lte: new Date('2026-09-02T11:58:00.000Z') } },
    ]),
  }))
})