import { Types, type ClientSession, type Model } from 'mongoose'
import type { Payload } from 'payload'
import { appendAuditEvent } from '../audit/append-event'
import { collectionCommandHash } from '../collections/idempotency'
import { AdminHttpError } from '../http/errors'
import {
  assertGrantableCollectionIds,
  newlyAddedCollectionIds,
  storedAllowedCollectionIds,
} from './allowlist'

type DocumentModel = Model<Record<string, unknown>>
export interface ConsumerApplicationInput {
  name?: string
  owner?: string
  status?: 'active' | 'suspended'
  allowedCollectionIds?: string[]
  defaultRequestsPerMinute?: number
}
export interface ApplicationCommandContext { actorId: string; requestId: string; idempotencyKey: string }

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function normalized(input: ConsumerApplicationInput, required: boolean): Required<ConsumerApplicationInput> | ConsumerApplicationInput {
  const name = input.name?.trim()
  const owner = input.owner?.trim()
  const ids = input.allowedCollectionIds ? [...new Set(input.allowedCollectionIds)] : undefined
  if ((required && (!name || !owner || !ids)) || (name !== undefined && (!name || name.length > 120)) ||
      (owner !== undefined && (!owner || owner.length > 200)) ||
      (input.status !== undefined && !['active', 'suspended'].includes(input.status)) ||
      (ids !== undefined && ids.some((id) => !Types.ObjectId.isValid(id))) ||
      (input.defaultRequestsPerMinute !== undefined && (!Number.isInteger(input.defaultRequestsPerMinute) || input.defaultRequestsPerMinute < 1 || input.defaultRequestsPerMinute > 100000))) {
    throw new AdminHttpError(400, 'invalid_request')
  }
  const result = { ...input, ...(name === undefined ? {} : { name }), ...(owner === undefined ? {} : { owner }), ...(ids === undefined ? {} : { allowedCollectionIds: ids }) }
  return required
    ? { name: result.name!, owner: result.owner!, status: result.status ?? 'active', allowedCollectionIds: result.allowedCollectionIds!, defaultRequestsPerMinute: result.defaultRequestsPerMinute ?? 60 }
    : result
}

function transactionUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ''
  return (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 20) || /Transaction numbers are only allowed|does not support transactions/i.test(message)
}

export class ConsumerApplicationService {
  private readonly applications: DocumentModel
  private readonly collections: DocumentModel
  private readonly audits: DocumentModel
  constructor(private readonly payload: Payload) {
    this.applications = modelFor(payload, 'consumer-applications')
    this.collections = modelFor(payload, 'collections')
    this.audits = modelFor(payload, 'audit-events')
  }

  private async inTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.payload.db.connection.startSession()
    try {
      let result: T | undefined
      try { await session.withTransaction(async () => { result = await work(session) }) }
      catch (error) { if (transactionUnsupported(error)) throw new AdminHttpError(503, 'service_unavailable'); throw error }
      return result as T
    } finally { await session.endSession() }
  }

  async list(): Promise<Record<string, unknown>[]> {
    return (await this.applications.find({}).sort({ name: 1 }).lean()).map((value) => this.public(value))
  }

  async create(input: ConsumerApplicationInput, context: ApplicationCommandContext): Promise<Record<string, unknown>> {
    const value = normalized(input, true) as Required<ConsumerApplicationInput>
    const hash = collectionCommandHash({ actorId: context.actorId, command: 'create_application', value })
    const eventKey = `application:create:${context.actorId}:${context.idempotencyKey}`
    const existing = await this.audits.findOne({ eventKey }).lean()
    if (existing) {
      const metadata = existing.metadata as { requestHash?: string; resultSnapshot?: Record<string, unknown> } | undefined
      if (metadata?.requestHash === hash && metadata.resultSnapshot) return metadata.resultSnapshot
      throw new AdminHttpError(409, 'idempotency_conflict')
    }
    const now = new Date()
    const document = { _id: new Types.ObjectId().toHexString(), ...value, allowedCollectionIds: value.allowedCollectionIds.map((collectionId) => ({ collectionId })), credentialsRevision: 0, revision: 1, createdAt: now, updatedAt: now }
    try {
      return await this.inTransaction(async (session) => {
        await assertGrantableCollectionIds(this.collections, value.allowedCollectionIds, session)
        const created = await this.applications.create([document], { session })
        const result = this.public(created[0].toObject())
        await appendAuditEvent(this.audits, { actorId: context.actorId, requestId: context.requestId, eventKey, eventType: 'application.created', applicationId: String(document._id), metadata: { requestHash: hash, resultSnapshot: result } }, session)
        return result
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000) throw new AdminHttpError(409, 'conflict')
      throw error
    }
  }

  async patch(id: string, ifMatch: number, input: ConsumerApplicationInput, context: ApplicationCommandContext): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) throw new AdminHttpError(404, 'not_found')
    const value = normalized(input, false)
    if (Object.keys(value).length === 0) throw new AdminHttpError(400, 'invalid_request')
    const hash = collectionCommandHash({ actorId: context.actorId, command: 'patch_application', id, ifMatch, value })
    const eventKey = `application:${id}:${context.idempotencyKey}`
    const prior = await this.audits.findOne({ eventKey }).lean()
    if (prior) {
      const metadata = prior.metadata as { requestHash?: string; resultSnapshot?: Record<string, unknown> } | undefined
      if (metadata?.requestHash === hash && metadata.resultSnapshot) return metadata.resultSnapshot
      throw new AdminHttpError(409, 'idempotency_conflict')
    }
    return this.inTransaction(async (session) => {
      const current = await this.applications.findById(id).session(session).lean()
      if (!current) throw new AdminHttpError(404, 'not_found')
      if (Number(current.revision) !== ifMatch) throw new AdminHttpError(412, 'revision_conflict')

      if (value.allowedCollectionIds !== undefined) {
        const additions = newlyAddedCollectionIds(
          storedAllowedCollectionIds(current.allowedCollectionIds),
          value.allowedCollectionIds,
        )
        await assertGrantableCollectionIds(this.collections, additions, session)
      }

      const update = { ...value, ...(value.allowedCollectionIds === undefined ? {} : { allowedCollectionIds: value.allowedCollectionIds.map((collectionId) => ({ collectionId })) }), updatedAt: new Date() }
      const changed = await this.applications.findOneAndUpdate({ _id: id, revision: ifMatch }, { $set: update, $inc: { revision: 1 } }, { new: true, session }).lean()
      if (!changed) {
        const exists = await this.applications.exists({ _id: id }).session(session)
        throw new AdminHttpError(exists ? 412 : 404, exists ? 'revision_conflict' : 'not_found')
      }
      const result = this.public(changed)
      await appendAuditEvent(this.audits, { actorId: context.actorId, requestId: context.requestId, eventKey, eventType: 'application.updated', applicationId: id, metadata: { requestHash: hash, resultSnapshot: result } }, session)
      return result
    })
  }

  private public(value: Record<string, unknown>): Record<string, unknown> {
    const allowed = storedAllowedCollectionIds(value.allowedCollectionIds)
    return { id: String(value.id ?? value._id), name: value.name, owner: value.owner, status: value.status, allowedCollectionIds: allowed, defaultRequestsPerMinute: value.defaultRequestsPerMinute, credentialsRevision: value.credentialsRevision, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt }
  }
}
