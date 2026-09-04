import { describe, expect, test } from 'vitest'
import {
  PAYLOAD_JOB_COLLECTION,
  assertChaosTimings,
  assertDisposableChaosTarget,
  evaluateRecoveredScenario,
  resolveChaosEnvironment,
  scenarioDefinition,
} from '../../chaos/worker-checkpoints.mjs'

describe('worker checkpoint chaos harness', () => {
  test('refuses production-shaped or non-test CMS databases', () => {
    expect(() => assertDisposableChaosTarget({
      mongoUrl: 'mongodb://127.0.0.1:27017',
      databaseName: 'concierge-cms',
      allowRemote: false,
    })).toThrow(/must end with -test/)

    expect(() => assertDisposableChaosTarget({
      mongoUrl: 'mongodb://127.0.0.1:27017',
      databaseName: 'concierge-production-test',
      allowRemote: false,
    })).toThrow(/production-like/)
  })

  test('requires explicit opt-in for remote Mongo even when database is disposable', () => {
    expect(() => assertDisposableChaosTarget({
      mongoUrl: 'mongodb+srv://user:secret@example.mongodb.net/',
      databaseName: 'concierge-cms-test',
      allowRemote: false,
    })).toThrow(/remote chaos requires/)

    expect(() => assertDisposableChaosTarget({
      mongoUrl: 'mongodb+srv://user:secret@example.mongodb.net/',
      databaseName: 'concierge-cms-test',
      allowRemote: true,
    })).not.toThrow()
  })

  test('validates timing arguments before an arm can claim the job is reclaimable', () => {
    expect(() => assertChaosTimings({
      phase: 'arm', timeoutMs: 120_000, pollMs: 1_000, staleSeconds: 179, recoveryStaleSeconds: 180,
    })).toThrow(/stale-seconds must be at least 180/)

    expect(() => assertChaosTimings({
      phase: 'verify', timeoutMs: 0, pollMs: 1_000, staleSeconds: 300, recoveryStaleSeconds: 180,
    })).toThrow(/timeout-ms must be a positive integer/)

    expect(() => assertChaosTimings({
      phase: 'verify', timeoutMs: 1_000, pollMs: 2_000, staleSeconds: 300, recoveryStaleSeconds: 180,
    })).toThrow(/poll-ms cannot exceed timeout-ms/)

    expect(() => assertChaosTimings({
      phase: 'arm', timeoutMs: 120_000, pollMs: 1_000, staleSeconds: 180, recoveryStaleSeconds: 180,
    })).not.toThrow()
  })

  test('never labels evidence as staging unless the operator says staging explicitly', () => {
    expect(resolveChaosEnvironment(undefined)).toBe('local')
    expect(resolveChaosEnvironment('staging')).toBe('staging')
    expect(resolveChaosEnvironment('local')).toBe('local')
    expect(() => resolveChaosEnvironment('production')).toThrow(/must be local or staging/)
  })

  test('uses Payload v3 raw Mongo collection name for queued jobs', () => {
    expect(PAYLOAD_JOB_COLLECTION).toBe('payload-jobs')
  })

  test('defines all four worker recovery scenarios without secrets or raw URLs', () => {
    expect(['draft', 'publish', 'selection', 'export'].map((name) => scenarioDefinition(name).domainCollection))
      .toEqual([
        'collection_operations',
        'collection_publish_jobs',
        'selection_manifests',
        'collection_exports',
      ])
  })

  test('draft recovery requires the target draft revision even after completed terminal status', () => {
    const result = evaluateRecoveredScenario('draft', {
      domain: {
        _id: 'op-1', collectionId: 'collection-1', idempotencyKey: 'idem-1',
        status: 'completed', targetDraftRevision: 8, jobId: 'payload-1', fencingToken: 2,
      },
      payloadJob: { _id: 'payload-1', processing: false, hasError: false, completedAt: new Date() },
      duplicateCount: 1,
      related: { collection: { draftRevision: 7 } },
    })

    expect(result.pass).toBe(false)
    expect(result.failures).toContain('draft_revision_not_advanced')
  })

  test('publish recovery requires the promoted version and same domain intent', () => {
    const result = evaluateRecoveredScenario('publish', {
      domain: {
        _id: 'job-1', collectionId: 'collection-1', idempotencyKey: 'idem-1',
        status: 'completed', targetVersion: 3, payloadJobId: 'payload-1', fencingToken: 2,
      },
      payloadJob: { _id: 'payload-1', processing: false, hasError: false, completedAt: new Date() },
      duplicateCount: 1,
      related: { collection: { currentPublishedVersion: 3 }, version: { status: 'published' } },
    })

    expect(result.pass).toBe(true)
    expect(result.expectedInvariant).toContain('version 3')
  })

  test('export recovery fails if terminal record lost object evidence', () => {
    const result = evaluateRecoveredScenario('export', {
      domain: {
        _id: 'export-1', actorId: 'admin-1', idempotencyKey: 'idem-1',
        status: 'complete', payloadJobId: 'payload-1', key: null, sha256: null,
      },
      payloadJob: { _id: 'payload-1', processing: false, hasError: false, completedAt: new Date() },
      duplicateCount: 1,
      related: {},
    })

    expect(result.pass).toBe(false)
    expect(result.failures).toEqual(expect.arrayContaining(['export_artifact_missing']))
  })
})
