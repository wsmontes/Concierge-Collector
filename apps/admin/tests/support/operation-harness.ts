import type { Model } from 'mongoose'
import type { Payload } from 'payload'
import { vi } from 'vitest'
import { createCollectionRepository } from '../../src/collections/repository'
import type { CollectionRecord } from '../../src/collections/types'
import { applyDraftOperation } from '../../src/operations/apply-draft-operation'
import { enqueueMultiTarget as enqueueMultiTargetImpl } from '../../src/operations/enqueue'
import type {
  DraftOperationRecord,
  EnqueueMultiTargetInput,
  ParentOperationRecord,
} from '../../src/operations/types'
import { getSharedPayload } from '../integration/support/collection-fixtures'
import { lease, page } from './factories'
import {
  createSelectionHarness,
  type MockedCatalog,
  type SelectionHarness,
} from './selection-harness'
import type { SelectionManifestRecord } from '../../src/selections/types'

const ACTOR_ID = 'admin-1'
const WORKER = 'operation-worker'

const TERMINAL = ['committed', 'completed', 'completed_with_skips', 'failed', 'cancelled', 'stale', 'conflicted', 'authorization_revoked']
const SUCCESS_TERMINAL = ['committed', 'completed', 'completed_with_skips']
const FAILED_TERMINAL = ['failed', 'cancelled', 'stale', 'conflicted', 'authorization_revoked']

/**
 * Operation harness for multi-target (selection-driven) draft operations.
 *
 * It materializes a REAL ready selection (three manifest rows c1/c2/c3) through
 * the manifest worker flow, creates two fresh Collections, and drives the
 * children of a parent operation through the real apply engine. The FastAPI
 * boundary is mocked exactly like the selection harness; `failNextCommitFor`
 * arms the engine's `beforeCommitting` hook per Collection.
 */
export interface OperationHarness {
  payload: Payload
  fastApi: MockedCatalog
  readySelection: SelectionManifestRecord
  collectionA: CollectionRecord
  collectionB: CollectionRecord
  enqueueMultiTarget(input: Omit<EnqueueMultiTargetInput, 'actorId' | 'requestId'>): Promise<ParentOperationRecord>
  failNextCommitFor(collectionId: string): void
  runChildren(parentId: string): Promise<void>
  loadCollection(collectionId: string): Promise<CollectionRecord>
  childrenOf(parentId: string): Promise<Array<Record<string, unknown>>>
  parentSummary(parentId: string): Promise<{ completed: number; failed: number }>
}

export async function createOperationHarness(): Promise<OperationHarness> {
  const payload = await getSharedPayload()
  const selection: SelectionHarness = await createSelectionHarness()
  const fastApi = selection.fastApi
  const created = await selection.createAllMatchingSelection({ filters: { q: 'sushi' } })
  fastApi.scanPage.mockResolvedValueOnce(page(['c1', 'c2', 'c3'], null))
  const materialized = await selection.materializeSelection(created.id, lease())
  if (materialized?.status !== 'ready') throw new Error('Operation harness requires a ready selection')
  const readySelection = await selection.loadSelection(created.id)

  const repository = createCollectionRepository(payload)
  const collectionA = await repository.createCollection(
    { slug: 'bulk-target-a', title: 'Bulk target A' },
    { actorId: ACTOR_ID, idempotencyKey: 'operation-harness-collection-a', requestId: 'operation-harness-collection-a-request' },
  )
  const collectionB = await repository.createCollection(
    { slug: 'bulk-target-b', title: 'Bulk target B' },
    { actorId: ACTOR_ID, idempotencyKey: 'operation-harness-collection-b', requestId: 'operation-harness-collection-b-request' },
  )

  const operations = payload.db.collections['collection-operations'] as unknown as Model<Record<string, unknown>>
  const failHooks = new Map<string, () => Promise<void>>()
  const resolver = {
    introspectAdmin: vi.fn(async () => undefined),
    resolveCurations: vi.fn(async (ids: string[]) => ({ eligibleIds: ids, rejected: [] })),
  }

  return {
    payload,
    fastApi,
    readySelection,
    collectionA,
    collectionB,
    enqueueMultiTarget: (input) => enqueueMultiTargetImpl(payload, {
      actorId: ACTOR_ID,
      requestId: `${input.idempotencyKey}-request`,
      ...input,
    }, { resolve: resolver }),
    failNextCommitFor: (collectionId) => {
      failHooks.set(collectionId, async () => { throw new Error('simulated_commit_failure') })
    },
    runChildren: async (parentId) => {
      const children = await operations.find({ parentOperationId: parentId }).lean() as Array<Record<string, unknown>>
      for (const child of children) {
        const childId = String(child._id)
        const collectionId = String(child.collectionId)
        const beforeCommitting = failHooks.get(collectionId)
        if (beforeCommitting) failHooks.delete(collectionId)
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const result = await applyDraftOperation(
            payload,
            childId,
            WORKER,
            resolver,
            beforeCommitting ? { beforeCommitting } : {},
          )
          if (!result || TERMINAL.includes(result.status)) break
        }
      }
    },
    loadCollection: (collectionId) => repository.getCollection(collectionId),
    childrenOf: async (parentId) => {
      const children = await operations.find({ parentOperationId: parentId }).lean()
      return children as Array<Record<string, unknown>>
    },
    parentSummary: async (parentId) => {
      const children = await operations.find({ parentOperationId: parentId }).lean() as Array<Record<string, unknown>>
      return {
        completed: children.filter((child) => SUCCESS_TERMINAL.includes(String(child.status))).length,
        failed: children.filter((child) => FAILED_TERMINAL.includes(String(child.status))).length,
      }
    },
  }
}

export type { DraftOperationRecord }
