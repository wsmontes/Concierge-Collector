import { Types, type ClientSession, type Model } from 'mongoose'
import type { Payload } from 'payload'
import { AdminHttpError } from '../http/errors'
import { normalizeExplicitCurationIds, draftOperationRequestHash } from './idempotency'
import { FastApiCatalogClient } from './catalog-client'
import type { CatalogResolver, CreateDraftOperationCommand, DraftOperationRecord } from './types'

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
 * Atomically writes the command, its full item snapshot and its Payload worker
 * job. The worker may safely run immediately after commit; it never observes a
 * command without its input rows nor an operation returned without a job.
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
  const curationIds = normalizeExplicitCurationIds(command.curationIds)
  const requestHash = draftOperationRequestHash({
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

  const resolved = await (dependencies.resolve ?? defaultDependencies().resolve).resolveCurations(curationIds, command.actorId)
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
      const operationDocument = {
        _id: operationId,
        collectionId: command.collectionId,
        mode: 'explicit',
        action: command.action,
        operationSequence,
        baseDraftRevision: command.baseDraftRevision,
        targetDraftRevision: command.baseDraftRevision + 1,
        idempotencyKey: command.idempotencyKey,
        requestHash,
        selectedCount: curationIds.length,
        status: 'queued',
        progress: { eligible: resolved.eligibleIds.length, skipped: resolved.rejected.length, staged: 0 },
        fencingToken: 0,
        actorId: command.actorId,
        requestId: command.requestId,
        jobId,
        createdAt: now,
        updatedAt: now,
      }
      await operations.create([operationDocument], { session })
      const operationItems = [
        ...resolved.eligibleIds.map((curationId) => ({
          operationId, curationId, desiredState: command.action, status: 'pending', targetDraftRevision: command.baseDraftRevision + 1,
        })),
        ...resolved.rejected.map((item) => ({
          operationId, curationId: item.curationId, desiredState: command.action, status: 'skipped', reasonCode: item.reason,
          targetDraftRevision: command.baseDraftRevision + 1,
        })),
      ]
      if (operationItems.length) await items.insertMany(operationItems, { session })
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
