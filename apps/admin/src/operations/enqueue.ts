import { Types, type ClientSession, type Model } from 'mongoose'
import type { Payload } from 'payload'
import { AdminHttpError } from '../http/errors'
import { collectionCommandHash } from '../collections/idempotency'
import { asRecord as asSelectionRecord } from '../selections/materialize-selection'
import type { SelectionManifestRecord } from '../selections/types'
import { hashRequest, normalizeExplicitCurationIds, draftOperationRequestHash } from './idempotency'
import { FastApiCatalogClient } from './catalog-client'
import type {
  CatalogResolver,
  CreateDraftOperationCommand,
  DraftOperationAction,
  DraftOperationRecord,
  EnqueueMultiTargetInput,
  ParentOperationRecord,
} from './types'

type DocumentModel = Model<Record<string, unknown>>

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function record(document: unknown): DraftOperationRecord {
  const value = document as Record<string, unknown>
  return { ...value, id: String(value.id ?? value._id) } as DraftOperationRecord
}

function parentRecord(document: unknown): ParentOperationRecord {
  const value = document as Record<string, unknown>
  return { ...value, id: String(value.id ?? value._id) } as ParentOperationRecord
}

function assertCollectionId(id: string): void {
  if (!/^[a-f\d]{24}$/i.test(id)) throw new AdminHttpError(404, 'not_found')
}

async function inTransaction<T>(payload: Payload, work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await payload.db.connection.startSession()
  try {
    let result: T | undefined
    await session.withTransaction(async () => { result = await work(session) })
    return result as T
  } finally {
    await session.endSession()
  }
}

export interface EnqueueDependencies {
  resolve: CatalogResolver
  /** Testes de integração dirigem apply/cancel direto; sem o job, o worker
   * vivo do stack de qualificação roubaria a operação entre o enqueue e o
   * apply manual (corrida observada no gate). Produção usa o default true. */
  createWorkerJob?: boolean
}

function defaultDependencies(): EnqueueDependencies {
  return { resolve: new FastApiCatalogClient() }
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000
}

async function existingIdempotentOperation(
  operations: DocumentModel,
  collectionId: string,
  idempotencyKey: string,
  requestHash: string,
): Promise<DraftOperationRecord | null> {
  const existing = await operations.findOne({ collectionId, idempotencyKey }).lean()
  if (!existing) return null
  if ((existing as { requestHash?: string }).requestHash !== requestHash) throw new AdminHttpError(409, 'idempotency_conflict')
  return record(existing)
}

async function draftLockedError(payload: Payload, collectionId: string): Promise<AdminHttpError> {
  const publishJobs = modelFor(payload, 'collection-publish-jobs')
  const blocking = await publishJobs.findOne({
    collectionId,
    status: { $in: ['queued', 'running', 'committing'] },
  }).sort({ createdAt: 1 }).lean()
  const blockingJobId = blocking ? String((blocking as Record<string, unknown>).id ?? (blocking as Record<string, unknown>)._id) : undefined
  return new AdminHttpError(423, 'draft_locked', blockingJobId ? { blockingJobId } : undefined)
}

/**
 * The manifest a selection-driven operation applies against: immutable,
 * owned by the acting admin, `ready` and unexpired. Expired manifests are gone
 * forever — the intent must be re-created.
 */
export async function requireReadyManifest(payload: Payload, selectionId: string, actorId: string): Promise<SelectionManifestRecord> {
  const manifests = modelFor(payload, 'selection-manifests')
  const document = await manifests.findOne({ _id: selectionId, actorId }).lean()
  if (!document) throw new AdminHttpError(404, 'not_found')
  const selection = asSelectionRecord(document)
  if (new Date(selection.expiresAt).getTime() <= Date.now()) throw new AdminHttpError(410, 'selection_expired')
  if (selection.status !== 'ready') throw new AdminHttpError(409, 'conflict')
  return selection
}

/** The draft revision a child must target; mirrors the enqueue CAS reads. */
export async function currentDraftRevision(payload: Payload, collectionId: string): Promise<number> {
  const collection = await modelFor(payload, 'collections').findById(collectionId).lean() as Record<string, unknown> | null
  if (!collection) throw new AdminHttpError(404, 'not_found')
  if (collection.lifecycle === 'archived') throw new AdminHttpError(409, 'conflict')
  if (collection.draftState === 'publishing') throw await draftLockedError(payload, collectionId)
  return Number(collection.draftRevision)
}

function parentRequestHash(input: {
  actorId: string
  action: DraftOperationAction
  collectionIds: string[]
  selectionHash: string
}): string {
  return collectionCommandHash({
    actorId: input.actorId,
    action: input.action,
    collectionIds: [...input.collectionIds].sort(),
    mode: 'selection',
    selectionHash: input.selectionHash,
  })
}

interface ParentOperationCommand {
  actorId: string
  action: DraftOperationAction
  collectionIds: string[]
  idempotencyKey: string
  requestId: string
  selectionHash: string
  selectionId: string
}

/**
 * Creates the parent operation under unique `(actorId, idempotencyKey)`
 * (partial index over documents without `parentOperationId`). The parent is a
 * pure intent: it carries no collectionId, no totals and no worker job — its
 * aggregated status is derived from the children at every read.
 */
async function createParentOperation(payload: Payload, command: ParentOperationCommand): Promise<ParentOperationRecord> {
  const operations = modelFor(payload, 'collection-operations')
  const requestHash = parentRequestHash(command)
  const now = new Date()
  const id = new Types.ObjectId().toHexString()
  const document: Record<string, unknown> = {
    _id: id,
    actorId: command.actorId,
    action: command.action,
    idempotencyKey: command.idempotencyKey,
    requestHash,
    mode: 'selection',
    selectionId: command.selectionId,
    selectionHash: command.selectionHash,
    // Explicit null (not a missing field): the partial unique index
    // `parent_idempotency_unique` filters on `{ parentOperationId: null }`.
    parentOperationId: null,
    status: 'active',
    requestId: command.requestId,
    createdAt: now,
    updatedAt: now,
  }
  try {
    // Raw driver insert: the parent intentionally lacks every required child
    // field (collectionId, operationSequence, ...) that Payload validates.
    await operations.collection.insertOne(document)
  } catch (error) {
    if (isDuplicateKey(error)) {
      const existing = await operations.findOne({
        actorId: command.actorId,
        idempotencyKey: command.idempotencyKey,
        parentOperationId: null,
      }).lean()
      if (existing) {
        if ((existing as Record<string, unknown>).requestHash !== requestHash) throw new AdminHttpError(409, 'idempotency_conflict')
        return parentRecord(existing)
      }
    }
    throw error
  }
  return parentRecord(document)
}

/**
 * Atomically writes the command, its full item snapshot and its Payload worker
 * job. The worker may safely run immediately after commit; it never observes a
 * command without its input rows nor an operation returned without a job.
 *
 * Selection children skip the ID snapshot entirely: the worker pages the
 * manifest cursor itself, so enqueue never materializes curation IDs.
 */
export async function enqueueDraftOperation(
  payload: Payload,
  command: CreateDraftOperationCommand,
  dependencies: Partial<EnqueueDependencies> = {},
): Promise<DraftOperationRecord> {
  assertCollectionId(command.collectionId)
  if (!Number.isInteger(command.baseDraftRevision) || command.baseDraftRevision < 0) {
    throw new AdminHttpError(400, 'invalid_request')
  }
  if (command.action !== 'add' && command.action !== 'remove') throw new AdminHttpError(400, 'invalid_request')
  const mode = command.mode ?? 'explicit'
  if (mode !== 'explicit' && mode !== 'selection') throw new AdminHttpError(400, 'invalid_request')
  if (mode === 'selection' && !command.selectionId) throw new AdminHttpError(400, 'invalid_request')
  const curationIds = mode === 'selection' ? [] : normalizeExplicitCurationIds(command.curationIds ?? [])
  const requestHash = command.requestHash ?? draftOperationRequestHash({
    collectionId: command.collectionId, action: command.action, baseDraftRevision: command.baseDraftRevision, curationIds,
  })
  const operations = modelFor(payload, 'collection-operations')
  const collectionModel = modelFor(payload, 'collections')

  const existing = await existingIdempotentOperation(operations, command.collectionId, command.idempotencyKey, requestHash)
  if (existing) return existing

  const collection = await collectionModel.findById(command.collectionId).lean() as Record<string, unknown> | null
  if (!collection) throw new AdminHttpError(404, 'not_found')
  if (collection.lifecycle === 'archived') throw new AdminHttpError(409, 'conflict')
  if (collection.draftState === 'publishing') throw await draftLockedError(payload, command.collectionId)
  if (collection.draftRevision !== command.baseDraftRevision) throw new AdminHttpError(412, 'revision_conflict')

  const resolved = mode === 'selection'
    ? null
    : await (dependencies.resolve ?? defaultDependencies().resolve).resolveCurations(curationIds, command.actorId)
  const items = modelFor(payload, 'collection-operation-items')
  const jobs = modelFor(payload, 'payload-jobs')
  const operationId = new Types.ObjectId().toHexString()
  const jobId = new Types.ObjectId().toHexString()
  const now = new Date()

  try {
    const operation = await inTransaction(payload, async (session) => {
      const counter = await collectionModel.findOneAndUpdate(
        {
          _id: command.collectionId,
          draftRevision: command.baseDraftRevision,
          draftState: { $ne: 'publishing' },
          lifecycle: { $ne: 'archived' },
        },
        { $inc: { operationSequenceCounter: 1 } },
        { new: true, lean: true, session },
      )
      if (!counter) {
        const current = await collectionModel.findById(command.collectionId).session(session).lean() as Record<string, unknown> | null
        if (!current) throw new AdminHttpError(404, 'not_found')
        if (current.lifecycle === 'archived') throw new AdminHttpError(409, 'conflict')
        if (current.draftState === 'publishing') throw await draftLockedError(payload, command.collectionId)
        throw new AdminHttpError(412, 'revision_conflict')
      }
      const operationSequence = Number((counter as Record<string, unknown>).operationSequenceCounter)
      const operationDocument: Record<string, unknown> = {
        _id: operationId,
        collectionId: command.collectionId,
        mode,
        ...(command.parentOperationId ? { parentOperationId: command.parentOperationId } : {}),
        ...(command.selectionId ? { selectionId: command.selectionId } : {}),
        action: command.action,
        operationSequence,
        baseDraftRevision: command.baseDraftRevision,
        targetDraftRevision: command.baseDraftRevision + 1,
        idempotencyKey: command.idempotencyKey,
        requestHash,
        selectedCount: mode === 'selection' ? command.selectedCount ?? 0 : curationIds.length,
        status: 'queued',
        progress: mode === 'selection'
          ? { processed: 0, skipped: 0, failed: 0 }
          : { eligible: resolved!.eligibleIds.length, skipped: resolved!.rejected.length, staged: 0 },
        fencingToken: 0,
        actorId: command.actorId,
        requestId: command.requestId,
        jobId,
        createdAt: now,
        updatedAt: now,
      }
      await operations.create([operationDocument], { session })
      if (mode === 'explicit') {
        const operationItems = [
          ...resolved!.eligibleIds.map((curationId) => ({
            operationId, curationId, desiredState: command.action, status: 'pending', targetDraftRevision: command.baseDraftRevision + 1,
          })),
          ...resolved!.rejected.map((item) => ({
            operationId, curationId: item.curationId, desiredState: command.action, status: 'skipped', reasonCode: item.reason,
            targetDraftRevision: command.baseDraftRevision + 1,
          })),
        ]
        if (operationItems.length) await items.insertMany(operationItems, { session })
      }
      if (dependencies.createWorkerJob !== false) {
        await jobs.create([{
          _id: jobId,
          input: { operationId },
          taskSlug: 'apply-draft-operation',
          queue: 'collection-mutations',
          processing: false,
          totalTried: 0,
          hasError: false,
          createdAt: now,
          updatedAt: now,
        }], { session })
      }
      return operationDocument
    })
    return record(operation)
  } catch (error) {
    if (isDuplicateKey(error)) {
      const retry = await existingIdempotentOperation(operations, command.collectionId, command.idempotencyKey, requestHash)
      if (retry) return retry
      throw new AdminHttpError(409, 'conflict')
    }
    throw error
  }
}

/**
 * Single-Collection selection command (admin per-collection endpoint): one
 * ready manifest, one child, no parent.
 */
export async function enqueueSelectionOperation(
  payload: Payload,
  input: {
    collectionId: string
    selectionId: string
    action: DraftOperationAction
    idempotencyKey: string
    actorId: string
    requestId: string
  },
  dependencies: Partial<EnqueueDependencies> = {},
): Promise<DraftOperationRecord> {
  const manifest = await requireReadyManifest(payload, input.selectionId, input.actorId)
  const baseDraftRevision = await currentDraftRevision(payload, input.collectionId)
  return enqueueDraftOperation(payload, {
    collectionId: input.collectionId,
    mode: 'selection',
    action: input.action,
    selectionId: manifest.id,
    baseDraftRevision,
    idempotencyKey: input.idempotencyKey,
    requestHash: hashRequest({ collectionId: input.collectionId, action: input.action, selectionHash: manifest.manifestHash ?? '' }),
    selectedCount: manifest.capturedCount,
    actorId: input.actorId,
    requestId: input.requestId,
  }, dependencies)
}

/**
 * Creates one parent plus one child per Collection. Children run in parallel;
 * each carries its own per-Collection sequence/revision and a request hash that
 * binds it to the manifest. The parent is created first under a unique
 * `(actorId, idempotencyKey)`, children are idempotent by
 * `(parentOperationId, collectionId)` and by `(collectionId, idempotencyKey)`,
 * so a retry only ever creates missing children.
 */
export async function enqueueMultiTarget(
  payload: Payload,
  input: EnqueueMultiTargetInput,
  dependencies: Partial<EnqueueDependencies> = {},
): Promise<ParentOperationRecord> {
  if (!input.selectionId || !input.actorId || !input.idempotencyKey || !input.requestId) throw new AdminHttpError(400, 'invalid_request')
  if (input.action !== 'add' && input.action !== 'remove') throw new AdminHttpError(400, 'invalid_request')
  const collectionIds = [...new Set(input.collectionIds)]
  if (!collectionIds.length || collectionIds.length > 200) throw new AdminHttpError(400, 'invalid_request')
  for (const collectionId of collectionIds) assertCollectionId(collectionId)

  const manifest = await requireReadyManifest(payload, input.selectionId, input.actorId)
  const selectionHash = manifest.manifestHash ?? ''
  const parent = await createParentOperation(payload, {
    actorId: input.actorId,
    action: input.action,
    collectionIds,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    selectionHash,
    selectionId: manifest.id,
  })
  await Promise.all(collectionIds.map(async (collectionId) => {
    await enqueueDraftOperation(payload, {
      collectionId,
      mode: 'selection',
      action: input.action,
      selectionId: manifest.id,
      baseDraftRevision: await currentDraftRevision(payload, collectionId),
      idempotencyKey: `${input.idempotencyKey}:${collectionId}`,
      requestHash: hashRequest({ collectionId, action: input.action, selectionHash }),
      parentOperationId: parent.id,
      selectedCount: manifest.capturedCount,
      actorId: input.actorId,
      requestId: input.requestId,
    }, dependencies)
  }))
  return parent
}
