import { randomUUID } from 'node:crypto'
import { Types, type ClientSession, type Model } from 'mongoose'
import type { Payload } from 'payload'
import { appendAuditEvent } from '../audit/append-event'
import { AdminHttpError } from '../http/errors'
import { collectionCommandHash, collectionCommandKey } from './idempotency'
import {
  decideLifecycle,
  LifecycleDecisionError,
  normalizeCollectionSlug,
  normalizeCollectionTitle,
} from './lifecycle'
import type { AuditContext, CollectionMetadataInput, CollectionRecord } from './types'

type DocumentModel = Model<Record<string, unknown>>

interface CollectionModels {
  auditEvents: DocumentModel
  collections: DocumentModel
}

type AtomicWork<T> = (session?: ClientSession) => Promise<T>

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function collectionModels(payload: Payload): CollectionModels {
  return {
    collections: modelFor(payload, 'collections'),
    auditEvents: modelFor(payload, 'audit-events'),
  }
}

function asRecord(document: unknown): CollectionRecord {
  if (!document || typeof document !== 'object') throw new Error('Collection document missing')
  const value = document as Record<string, unknown>
  return {
    ...value,
    id: String(value.id ?? value._id),
  } as CollectionRecord
}

function duplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000
}

function revisionConflict(error: unknown): boolean {
  return error instanceof AdminHttpError && error.status === 412
}

function transactionUnsupported(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  const message = error instanceof Error ? error.message : ''
  return code === 20 || /Transaction numbers are only allowed|does not support transactions/i.test(message)
}

async function atomically<T>(payload: Payload, work: AtomicWork<T>): Promise<T> {
  const connection = payload.db.connection
  const session = await connection.startSession()
  try {
    let result: T | undefined
    try {
      await session.withTransaction(async () => {
        result = await work(session)
      })
      return result as T
    } catch (error) {
      // Audit and lifecycle CAS are one command. A standalone Mongo fallback
      // would allow a state mutation to survive without its append-only audit.
      if (transactionUnsupported(error)) throw new AdminHttpError(503, 'service_unavailable')
      throw error
    }
  } finally {
    await session.endSession()
  }
}

function patchData(record: CollectionRecord, input: CollectionMetadataInput): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  if (input.slug !== undefined) metadata.slug = normalizeCollectionSlug(input.slug)
  if (input.title !== undefined) metadata.title = normalizeCollectionTitle(input.title)
  if (input.description !== undefined) metadata.description = input.description

  if (record.everPublished) {
    metadata.draftBaseVersion = record.currentPublishedVersion
  }
  metadata.draftState = 'dirty'
  metadata.updatedAt = new Date()
  return metadata
}

function normalizeMetadata(input: CollectionMetadataInput): CollectionMetadataInput {
  return {
    ...(input.slug === undefined ? {} : { slug: normalizeCollectionSlug(input.slug) }),
    ...(input.title === undefined ? {} : { title: normalizeCollectionTitle(input.title) }),
    ...(input.description === undefined ? {} : { description: input.description }),
  }
}

function assertCollectionId(id: string): void {
  if (!/^[a-f\d]{24}$/i.test(id)) throw new AdminHttpError(404, 'not_found')
}

interface IdempotencyMetadata {
  requestHash?: unknown
  resultSnapshot?: unknown
}

function idempotencyMetadata(metadata: Record<string, unknown>, requestHash: string, resultSnapshot: unknown): Record<string, unknown> {
  return { ...metadata, requestHash, resultSnapshot }
}

export class CollectionRepository {
  private readonly models: CollectionModels

  constructor(private readonly payload: Payload) {
    this.models = collectionModels(payload)
  }

  private async idempotentSnapshot<T>(eventKey: string, requestHash: string): Promise<T | null> {
    const existing = await this.models.auditEvents.findOne({ eventKey }).lean()
    if (!existing) return null

    const metadata = (existing as { metadata?: IdempotencyMetadata }).metadata
    if (metadata?.requestHash !== requestHash || !('resultSnapshot' in (metadata ?? {}))) {
      throw new AdminHttpError(409, 'idempotency_conflict')
    }
    return metadata.resultSnapshot as T
  }

  private async idempotencyRace<T>(eventKey: string, requestHash: string): Promise<T | null> {
    return this.idempotentSnapshot<T>(eventKey, requestHash)
  }

  async createCollection(input: Required<Pick<CollectionMetadataInput, 'slug' | 'title'>> & Pick<CollectionMetadataInput, 'description'>, audit: AuditContext): Promise<CollectionRecord> {
    let normalizedInput: CollectionMetadataInput
    try {
      normalizedInput = normalizeMetadata(input)
    } catch (error) {
      if (error instanceof LifecycleDecisionError) throw new AdminHttpError(400, 'invalid_request')
      throw error
    }
    if (!normalizedInput.slug || !normalizedInput.title) throw new AdminHttpError(400, 'invalid_request')

    const requestHash = collectionCommandHash({
      actorId: audit.actorId,
      command: 'create',
      metadata: normalizedInput,
    })
    const auditEventKey = collectionCommandKey(`create:${audit.actorId}`, audit.idempotencyKey)
    const previous = await this.idempotentSnapshot<CollectionRecord>(auditEventKey, requestHash)
    if (previous) return asRecord(previous)

    const now = new Date()
    const id = new Types.ObjectId().toHexString()
    const record = {
      _id: id,
      slug: normalizedInput.slug,
      title: normalizedInput.title,
      description: normalizedInput.description ?? null,
      lifecycle: 'draft',
      draftEpoch: randomUUID(),
      draftRevision: 0,
      draftState: 'clean',
      publishedSelectedCount: 0,
      draftSelectedCount: 0,
      revision: 1,
      everPublished: false,
      createdAt: now,
      updatedAt: now,
    }

    try {
      return await atomically(this.payload, async (session) => {
        const created = await this.models.collections.create([record], { session })
        const result = asRecord(created[0])
        await appendAuditEvent(this.models.auditEvents, {
          actorId: audit.actorId,
          afterRevision: result.revision,
          collectionId: result.id,
          eventKey: auditEventKey,
          eventType: 'collection.created',
          metadata: idempotencyMetadata({ slug: result.slug }, requestHash, result),
          requestId: audit.requestId,
        }, session)
        return result
      })
    } catch (error) {
      if (duplicateKey(error)) {
        const retry = await this.idempotencyRace<CollectionRecord>(auditEventKey, requestHash)
        if (retry) return asRecord(retry)
        throw new AdminHttpError(409, 'conflict')
      }
      if (error instanceof LifecycleDecisionError) throw new AdminHttpError(400, 'invalid_request')
      throw error
    }
  }

  async getCollection(id: string): Promise<CollectionRecord> {
    assertCollectionId(id)
    const result = await this.models.collections.findById(id).lean()
    if (!result) throw new AdminHttpError(404, 'not_found')
    return asRecord(result)
  }

  async patchCollectionMetadata(id: string, ifMatch: number, input: CollectionMetadataInput, audit: AuditContext): Promise<CollectionRecord> {
    assertCollectionId(id)
    let normalizedInput: CollectionMetadataInput
    try {
      normalizedInput = normalizeMetadata(input)
    } catch (error) {
      if (error instanceof LifecycleDecisionError) throw new AdminHttpError(400, 'invalid_request')
      throw error
    }
    const requestHash = collectionCommandHash({
      actorId: audit.actorId,
      command: 'patch',
      collectionId: id,
      ifMatch,
      metadata: normalizedInput,
    })
    const auditEventKey = collectionCommandKey(`collection:${id}`, audit.idempotencyKey)
    const previous = await this.idempotentSnapshot<CollectionRecord>(auditEventKey, requestHash)
    if (previous) return asRecord(previous)

    const current = await this.getCollection(id)
    if (current.draftState === 'publishing') throw new AdminHttpError(423, 'draft_locked')
    try {
      const decision = decideLifecycle(current, 'patch', normalizedInput)
      if (decision === 'reject') throw new AdminHttpError(409, 'conflict')
      return await atomically(this.payload, async (session) => {
        const update = patchData(current, normalizedInput)
        const result = await this.models.collections.findOneAndUpdate(
          { _id: id, revision: ifMatch, lifecycle: current.lifecycle },
          { $set: update, $inc: { revision: 1, draftRevision: 1 } },
          { new: true, lean: true, runValidators: true, session },
        )
        if (!result) throw new AdminHttpError(412, 'revision_conflict')
        const updated = asRecord(result)
        await appendAuditEvent(this.models.auditEvents, {
          actorId: audit.actorId,
          afterRevision: updated.revision,
          beforeRevision: current.revision,
          collectionId: updated.id,
          eventKey: auditEventKey,
          eventType: 'collection.metadata_patched',
          metadata: idempotencyMetadata(
            { changed: Object.keys(update).filter((key) => key !== 'updatedAt') },
            requestHash,
            updated,
          ),
          requestId: audit.requestId,
        }, session)
        return updated
      })
    } catch (error) {
      if (duplicateKey(error) || revisionConflict(error)) {
        const retry = await this.idempotencyRace<CollectionRecord>(auditEventKey, requestHash)
        if (retry) return asRecord(retry)
      }
      if (duplicateKey(error)) {
        throw new AdminHttpError(409, 'conflict')
      }
      if (error instanceof LifecycleDecisionError) throw new AdminHttpError(400, 'invalid_request')
      throw error
    }
  }

  async hardDeleteNeverPublished(id: string, ifMatch: number, audit: AuditContext): Promise<void> {
    assertCollectionId(id)
    const requestHash = collectionCommandHash({ actorId: audit.actorId, command: 'delete', collectionId: id, ifMatch })
    const auditEventKey = collectionCommandKey(`collection:${id}`, audit.idempotencyKey)
    if (await this.idempotentSnapshot(auditEventKey, requestHash)) return

    const current = await this.getCollection(id)
    if (decideLifecycle(current, 'delete') !== 'hard-delete') throw new AdminHttpError(409, 'conflict')

    try {
      await atomically(this.payload, async (session) => {
        const deleted = await this.models.collections.findOneAndDelete(
          { _id: id, revision: ifMatch, lifecycle: 'draft', everPublished: false },
          { session },
        )
        if (!deleted) throw new AdminHttpError(412, 'revision_conflict')
        await appendAuditEvent(this.models.auditEvents, {
          actorId: audit.actorId,
          beforeRevision: current.revision,
          collectionId: current.id,
          eventKey: auditEventKey,
          eventType: 'collection.deleted',
          metadata: idempotencyMetadata({}, requestHash, { deleted: true, id: current.id }),
          requestId: audit.requestId,
        }, session)
      })
    } catch (error) {
      if ((duplicateKey(error) || revisionConflict(error)) && await this.idempotencyRace(auditEventKey, requestHash)) return
      if (duplicateKey(error)) throw new AdminHttpError(409, 'conflict')
      throw error
    }
  }

  async archiveCollection(id: string, ifMatch: number, audit: AuditContext): Promise<CollectionRecord> {
    return this.transition(id, ifMatch, 'archive', audit)
  }

  async restoreCollection(id: string, ifMatch: number, audit: AuditContext): Promise<CollectionRecord> {
    return this.transition(id, ifMatch, 'restore', audit)
  }

  private async transition(
    id: string,
    ifMatch: number,
    command: 'archive' | 'restore',
    audit: AuditContext,
  ): Promise<CollectionRecord> {
    assertCollectionId(id)
    const requestHash = collectionCommandHash({ actorId: audit.actorId, command, collectionId: id, ifMatch })
    const auditEventKey = collectionCommandKey(`collection:${id}`, audit.idempotencyKey)
    const previous = await this.idempotentSnapshot<CollectionRecord>(auditEventKey, requestHash)
    if (previous) return asRecord(previous)

    const current = await this.getCollection(id)
    const decision = decideLifecycle(current, command)
    if (decision === 'reject') throw new AdminHttpError(409, 'conflict')

    try {
      return await atomically(this.payload, async (session) => {
        const result = await this.models.collections.findOneAndUpdate(
          { _id: id, revision: ifMatch, lifecycle: current.lifecycle, everPublished: true },
          { $set: { lifecycle: decision, updatedAt: new Date() }, $inc: { revision: 1 } },
          { new: true, lean: true, session },
        )
        if (!result) throw new AdminHttpError(412, 'revision_conflict')
        const updated = asRecord(result)
        await appendAuditEvent(this.models.auditEvents, {
          actorId: audit.actorId,
          afterRevision: updated.revision,
          beforeRevision: current.revision,
          collectionId: updated.id,
          eventKey: auditEventKey,
          eventType: `collection.${command}d`,
          metadata: idempotencyMetadata(
            { currentPublishedVersion: current.currentPublishedVersion ?? null },
            requestHash,
            updated,
          ),
          requestId: audit.requestId,
        }, session)
        return updated
      })
    } catch (error) {
      if (duplicateKey(error) || revisionConflict(error)) {
        const retry = await this.idempotencyRace<CollectionRecord>(auditEventKey, requestHash)
        if (retry) return asRecord(retry)
      }
      if (duplicateKey(error)) {
        throw new AdminHttpError(409, 'conflict')
      }
      throw error
    }
  }
}

export function createCollectionRepository(payload: Payload): CollectionRepository {
  return new CollectionRepository(payload)
}
