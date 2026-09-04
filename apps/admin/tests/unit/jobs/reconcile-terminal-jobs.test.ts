import { expect, test, vi } from 'vitest'
import { reconcileRecoverableJobs } from '../../../src/jobs/reconcileLeasesTask'

const now = new Date('2026-09-02T12:00:00.000Z')
const stale = new Date('2026-09-02T11:50:00.000Z')

function activeModel() {
  return {
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    }),
    findOne: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
  }
}

function terminalLookupModel(jobField: string, successStatus: string, expectedJobId: string) {
  return {
    ...activeModel(),
    findOne: vi.fn((query: Record<string, unknown>) => ({
      lean: vi.fn().mockResolvedValue(
        query[jobField] === expectedJobId && (query.status as { $in?: string[] })?.$in?.includes(successStatus)
          ? { _id: `domain-${expectedJobId}`, status: successStatus, [jobField]: expectedJobId }
          : null,
      ),
    })),
  }
}

test('reopens stale processing Payload job only after matching a successful domain record', async () => {
  const stuckJob = {
    _id: 'payload-terminal-1', taskSlug: 'publish-collection', processing: true,
    hasError: false, completedAt: null, updatedAt: stale, meta: {},
  }
  const terminalFind = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([stuckJob]) }),
    }),
  })
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const payloadJobs = {
    find: terminalFind,
    findById: vi.fn(),
    updateOne,
  }
  const payload = {
    db: { collections: {
      'collection-operations': activeModel(),
      'collection-publish-jobs': terminalLookupModel('payloadJobId', 'completed', stuckJob._id),
      'selection-manifests': activeModel(),
      'collection-exports': activeModel(),
      'payload-jobs': payloadJobs,
    } },
  }

  const result = await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000, maxRecoveries: 3 })

  expect(result.recovered).toBe(1)
  expect(updateOne).toHaveBeenCalledWith(
    { _id: stuckJob._id, processing: true, updatedAt: { $lte: new Date('2026-09-02T11:58:00.000Z') } },
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

test('does not reopen an unrelated or non-success Payload job from the terminal cleanup scan', async () => {
  const stuckJob = {
    _id: 'payload-active-not-terminal', taskSlug: 'export-selection', processing: true,
    hasError: false, completedAt: null, updatedAt: stale, meta: {},
  }
  const payloadJobs = {
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([stuckJob]) }),
      }),
    }),
    findById: vi.fn(),
    updateOne: vi.fn(),
  }
  const exports = activeModel()
  exports.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) })
  const payload = {
    db: { collections: {
      'collection-operations': activeModel(),
      'collection-publish-jobs': activeModel(),
      'selection-manifests': activeModel(),
      'collection-exports': exports,
      'payload-jobs': payloadJobs,
    } },
  }

  const result = await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })

  expect(result.recovered).toBe(0)
  expect(payloadJobs.updateOne).not.toHaveBeenCalled()
})

test('terminal cleanup scan is bounded, age-ordered and limited to domain worker task slugs', async () => {
  const terminalFind = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
    }),
  })
  const payload = {
    db: { collections: {
      'collection-operations': activeModel(),
      'collection-publish-jobs': activeModel(),
      'selection-manifests': activeModel(),
      'collection-exports': activeModel(),
      'payload-jobs': { find: terminalFind, findById: vi.fn(), updateOne: vi.fn() },
    } },
  }

  await reconcileRecoverableJobs(payload as never, now, { staleProcessingMs: 120_000 })

  expect(terminalFind).toHaveBeenCalledWith(expect.objectContaining({
    taskSlug: { $in: ['apply-draft-operation', 'publish-collection', 'materialize-selection', 'export-selection'] },
    $or: expect.arrayContaining([
      { hasError: true },
      { completedAt: { $ne: null } },
      { processing: true, updatedAt: { $lte: new Date('2026-09-02T11:58:00.000Z') } },
    ]),
  }))
})
