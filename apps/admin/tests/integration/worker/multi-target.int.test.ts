import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Model } from 'mongoose'
import type { Payload } from 'payload'
import { createOperationHarness } from '../../support/operation-harness'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

integrationSuite('multi-target draft operations', () => {
  let payload: Payload
  let collections: Model<Record<string, unknown>>
  let operations: Model<Record<string, unknown>>
  let items: Model<Record<string, unknown>>
  let changes: Model<Record<string, unknown>>
  let audits: Model<Record<string, unknown>>
  let jobs: Model<Record<string, unknown>>
  let manifests: Model<Record<string, unknown>>
  let manifestItems: Model<Record<string, unknown>>
  let memberships: Model<Record<string, unknown>>
  let sessions: Model<Record<string, unknown>>
  let users: Model<Record<string, unknown>>

  beforeAll(async () => {
    if (!hasTestMongo) return
    const { getSharedPayload } = await import('../support/collection-fixtures')
    payload = await getSharedPayload()
    collections = payload.db.collections.collections as unknown as Model<Record<string, unknown>>
    operations = payload.db.collections['collection-operations'] as unknown as Model<Record<string, unknown>>
    items = payload.db.collections['collection-operation-items'] as unknown as Model<Record<string, unknown>>
    changes = payload.db.collections['collection-draft-changes'] as unknown as Model<Record<string, unknown>>
    audits = payload.db.collections['audit-events'] as unknown as Model<Record<string, unknown>>
    jobs = payload.db.collections['payload-jobs'] as unknown as Model<Record<string, unknown>>
    manifests = payload.db.collections['selection-manifests'] as unknown as Model<Record<string, unknown>>
    manifestItems = payload.db.collections['selection-manifest-items'] as unknown as Model<Record<string, unknown>>
    memberships = payload.db.collections['collection-memberships'] as unknown as Model<Record<string, unknown>>
    sessions = payload.db.collections['cms-sessions'] as unknown as Model<Record<string, unknown>>
    users = payload.db.collections['cms-users'] as unknown as Model<Record<string, unknown>>
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (!hasTestMongo) return
    await Promise.all([
      collections.deleteMany({}),
      operations.deleteMany({}),
      items.deleteMany({}),
      changes.deleteMany({}),
      audits.deleteMany({}),
      jobs.deleteMany({}),
      manifests.deleteMany({}),
      manifestItems.deleteMany({}),
      memberships.deleteMany({}),
      sessions.deleteMany({}),
      users.deleteMany({}),
    ])
  })

  test('multi-target expõe sucesso e falha por Collection', async () => {
    const { readySelection, collectionA, collectionB, enqueueMultiTarget, failNextCommitFor, runChildren, loadCollection, parentSummary } = await createOperationHarness()
    const parent = await enqueueMultiTarget({
      selectionId: readySelection.id,
      collectionIds: [collectionA.id, collectionB.id], action: 'add',
      idempotencyKey: 'bulk-test-1',
    })
    failNextCommitFor(collectionB.id)
    await runChildren(parent.id)
    expect((await loadCollection(collectionA.id)).draftSelectedCount).toBe(3)
    expect((await loadCollection(collectionB.id)).draftSelectedCount).toBe(0)
    expect(await parentSummary(parent.id)).toMatchObject({ completed: 1, failed: 1 })
  })

  test('retry do parent não duplica children e só recria os ausentes', async () => {
    const { readySelection, collectionA, collectionB, enqueueMultiTarget, childrenOf } = await createOperationHarness()
    const input = {
      selectionId: readySelection.id,
      collectionIds: [collectionA.id, collectionB.id],
      action: 'add' as const,
      idempotencyKey: 'bulk-retry-1',
    }
    const first = await enqueueMultiTarget(input)
    const retried = await enqueueMultiTarget(input)
    expect(retried.id).toBe(first.id)
    expect(await childrenOf(first.id)).toHaveLength(2)

    // Simula uma criação parcial interrompida: remove um child e reenqueue.
    const before = await childrenOf(first.id)
    const removed = before.find((child) => child.collectionId === collectionA.id)
    if (!removed) throw new Error('Child for collection A missing')
    await operations.deleteOne({ _id: removed._id })
    await jobs.deleteMany({ 'input.operationId': String(removed._id) })

    const again = await enqueueMultiTarget(input)
    expect(again.id).toBe(first.id)
    const after = await childrenOf(first.id)
    expect(after).toHaveLength(2)
    const recreated = after.find((child) => child.collectionId === collectionA.id)
    if (!recreated) throw new Error('Child for collection A not recreated')
    expect(String(recreated._id)).not.toBe(String(removed._id))
  })

  test('invariante terminal: processed + skipped + failed = selectedManifestCount', async () => {
    const { readySelection, collectionA, enqueueMultiTarget, runChildren, childrenOf } = await createOperationHarness()
    const parent = await enqueueMultiTarget({
      selectionId: readySelection.id,
      collectionIds: [collectionA.id], action: 'add',
      idempotencyKey: 'bulk-invariant-1',
    })
    await runChildren(parent.id)
    const [child] = await childrenOf(parent.id)
    if (!child) throw new Error('Child missing')
    const selectedCount = Number(child.selectedCount)
    expect(selectedCount).toBe(3)
    const progress = (child.progress ?? {}) as Record<string, number>
    expect(progress.processed + progress.skipped + progress.failed).toBe(selectedCount)
    expect(progress.processed).toBe(3)
  })

  test('request hash da variante selection incorpora o selectionHash', async () => {
    const { readySelection, collectionA, enqueueMultiTarget, childrenOf } = await createOperationHarness()
    const parent = await enqueueMultiTarget({
      selectionId: readySelection.id,
      collectionIds: [collectionA.id], action: 'add',
      idempotencyKey: 'bulk-hash-1',
    })
    const { hashRequest } = await import('../../../src/operations/idempotency')
    const [child] = await childrenOf(parent.id)
    if (!child) throw new Error('Child missing')
    expect(child.requestHash).toBe(hashRequest({
      collectionId: collectionA.id,
      action: 'add',
      selectionHash: readySelection.manifestHash ?? '',
    }))
    expect(child.mode).toBe('selection')
    expect(child.parentOperationId).toBe(parent.id)
    expect(child.selectionId).toBe(readySelection.id)
  })
})
