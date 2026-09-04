import { expect, test, vi } from 'vitest'
import { reconcileRecoverableJobs } from '../../../src/jobs/reconcileLeasesTask'

const now = new Date('2026-09-04T12:00:00.000Z')
const stale = new Date('2026-09-04T11:50:00.000Z')
const expiredLease = new Date('2026-09-04T11:55:00.000Z')

function domainModel(domain: Record<string, unknown> | null = null, missingRows: Record<string, unknown>[] = []) {
  return {
    findOne: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(domain) }),
    }),
    aggregate: vi.fn().mockResolvedValue(missingRows),
  }
}

function jobsModel(stuck: Record<string, unknown>[]) {
  return {
    collection: { name: 'payload-jobs-physical' },
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(stuck) }),
      }),
    }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  }
}

test('recovery starts from stuck Payload jobs so older healthy domain intents cannot starve it', async () => {
  const job = {
    _id: 'job-stuck-newer', taskSlug: 'apply-draft-operation', processing: true,
    hasError: false, completedAt: null, updatedAt: stale, meta: {},
  }
  const operations = domainModel({
    _id: 'op-stuck-newer', jobId: job._id, status: 'staging', leaseExpiresAt: expiredLease,
  })
  const jobs = jobsModel([job])
  const payload = { db: { collections: {
    'collection-operations': operations,
    'collection-publish-jobs': domainModel(),
    'selection-manifests': domainModel(),
    'collection-exports': domainModel(),
    'payload-jobs': jobs,
  } } }

  const result = await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })

  expect(result.recovered).toBe(1)
  expect(operations.findOne).toHaveBeenCalledWith({ jobId: job._id })
  expect(jobs.updateOne).toHaveBeenCalledWith(
    { _id: job._id, processing: true, updatedAt: { $lte: new Date('2026-09-04T11:58:00.000Z') } },
    expect.objectContaining({ $set: expect.objectContaining({ processing: false, waitUntil: now }) }),
  )
})

test('permanently failed domain job is classified once so it cannot occupy the stuck-job batch forever', async () => {
  const job = {
    _id: 'job-failed-domain', taskSlug: 'export-selection', processing: false,
    hasError: true, completedAt: null, updatedAt: stale, meta: {},
  }
  const exports = domainModel({
    _id: 'export-failed', payloadJobId: job._id, status: 'failed', leaseExpiresAt: null,
  })
  const jobs = jobsModel([job])
  const payload = { db: { collections: {
    'collection-operations': domainModel(),
    'collection-publish-jobs': domainModel(),
    'selection-manifests': domainModel(),
    'collection-exports': exports,
    'payload-jobs': jobs,
  } } }

  await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })

  expect(jobs.updateOne).toHaveBeenCalledWith(
    expect.objectContaining({ _id: job._id, hasError: true, 'meta.recoveryIgnoredAt': { $exists: false } }),
    { $set: expect.objectContaining({
      'meta.recoveryIgnoredAt': now.toISOString(),
      'meta.recoveryIgnoredReason': 'domain_terminal_failure',
      'meta.recoveryIgnoredDomainStatus': 'failed',
    }) },
  )
})

test('missing domain intents are filtered by lookup before the bounded limit', async () => {
  const operations = domainModel(null, [{ _id: 'op-missing-job' }])
  const jobs = jobsModel([])
  const payload = { db: { collections: {
    'collection-operations': operations,
    'collection-publish-jobs': domainModel(),
    'selection-manifests': domainModel(),
    'collection-exports': domainModel(),
    'payload-jobs': jobs,
  } } }

  const result = await reconcileRecoverableJobs(payload as never, now)

  expect(result.missing).toBe(1)
  const pipeline = operations.aggregate.mock.calls[0][0] as Record<string, unknown>[]
  const lookupIndex = pipeline.findIndex((stage) => '$lookup' in stage)
  const missingMatchIndex = pipeline.findIndex((stage) => JSON.stringify(stage).includes('_recoveryJob.0'))
  const limitIndex = pipeline.findIndex((stage) => '$limit' in stage)
  expect(lookupIndex).toBeGreaterThanOrEqual(0)
  expect(missingMatchIndex).toBeGreaterThan(lookupIndex)
  expect(limitIndex).toBeGreaterThan(missingMatchIndex)
  expect(pipeline[lookupIndex]).toEqual(expect.objectContaining({
    $lookup: expect.objectContaining({ from: 'payload-jobs-physical' }),
  }))
})

test('stuck-job scan excludes already classified unrecoverable jobs before its limit', async () => {
  const jobs = jobsModel([])
  const payload = { db: { collections: {
    'collection-operations': domainModel(),
    'collection-publish-jobs': domainModel(),
    'selection-manifests': domainModel(),
    'collection-exports': domainModel(),
    'payload-jobs': jobs,
  } } }

  await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })

  expect(jobs.find).toHaveBeenCalledWith(expect.objectContaining({
    'meta.recoveryIgnoredAt': { $exists: false },
    taskSlug: { $in: ['apply-draft-operation', 'publish-collection', 'materialize-selection', 'export-selection'] },
  }))
})