import { Types, type ClientSession, type Model } from 'mongoose'
import type { Payload } from 'payload'
import { appendAuditEvent } from '../audit/append-event'
import { AdminHttpError } from '../http/errors'
import type { CredentialRepository } from './credentials'
import type { ConsumerApplicationRecord, ConsumerCredentialRecord } from './types'

type DocumentModel = Model<Record<string, unknown>>

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function transactionUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ''
  return (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 20) || /Transaction numbers are only allowed|does not support transactions/i.test(message)
}

/** A request-scoped repository: each state change and its audit share a transaction. */
export class PayloadCredentialRepository implements CredentialRepository {
  private readonly applications: DocumentModel
  private readonly credentials: DocumentModel
  private readonly audits: DocumentModel

  constructor(
    private readonly payload: Payload,
    private readonly actorId: string,
    private readonly requestId: string,
  ) {
    this.applications = modelFor(payload, 'consumer-applications')
    this.credentials = modelFor(payload, 'consumer-credentials')
    this.audits = modelFor(payload, 'audit-events')
  }

  newCredentialId(): string {
    return new Types.ObjectId().toHexString()
  }

  async activeApplication(applicationId: string): Promise<ConsumerApplicationRecord | null> {
    if (!Types.ObjectId.isValid(applicationId)) return null
    const document = await this.applications.findOne({ _id: applicationId, status: 'active' }).lean()
    if (!document) return null
    return { id: String(document._id), status: 'active', credentialsRevision: Number(document.credentialsRevision ?? 0) }
  }

  private async inTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.payload.db.connection.startSession()
    try {
      let result: T | undefined
      try {
        await session.withTransaction(async () => { result = await work(session) })
      } catch (error) {
        if (transactionUnsupported(error)) throw new AdminHttpError(503, 'service_unavailable')
        throw error
      }
      return result as T
    } finally {
      await session.endSession()
    }
  }

  async issueCredential(credential: ConsumerCredentialRecord): Promise<void> {
    await this.inTransaction(async (session) => {
      const application = await this.applications.findOneAndUpdate(
        { _id: credential.applicationId, status: 'active' },
        { $inc: { credentialsRevision: 1 }, $set: { updatedAt: credential.createdAt } },
        { new: true, session },
      ).lean()
      if (!application) throw new AdminHttpError(404, 'not_found')
      await this.credentials.create([{ _id: credential.id, ...credential, updatedAt: credential.createdAt }], { session })
      await appendAuditEvent(this.audits, {
        actorId: this.actorId, requestId: this.requestId, eventKey: `credential:${credential.id}:issued`,
        eventType: 'credential.issued', applicationId: credential.applicationId, credentialId: credential.id,
        metadata: { prefix: credential.prefix, scopes: credential.scopes, expiresAt: credential.expiresAt?.toISOString() ?? null },
      }, session)
    })
  }

  async findCredential(id: string): Promise<ConsumerCredentialRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null
    const document = await this.credentials.findById(id).lean()
    return document ? this.toCredential(document) : null
  }

  async revokeCredential(id: string, actorId: string, now: Date): Promise<{ credential: ConsumerCredentialRecord; changed: boolean } | null> {
    if (!Types.ObjectId.isValid(id)) return null
    return this.inTransaction(async (session) => {
      const changed = await this.credentials.findOneAndUpdate(
        { _id: id, status: 'active' }, { $set: { status: 'revoked', revokedAt: now, revokedBy: actorId, updatedAt: now } },
        { new: true, session },
      ).lean()
      if (!changed) {
        const existing = await this.credentials.findById(id).session(session).lean()
        return existing ? { credential: this.toCredential(existing), changed: false } : null
      }
      const credential = this.toCredential(changed)
      await this.applications.updateOne({ _id: credential.applicationId }, { $inc: { credentialsRevision: 1 }, $set: { updatedAt: now } }, { session })
      await appendAuditEvent(this.audits, {
        actorId, requestId: this.requestId, eventKey: `credential:${credential.id}:revoked`, eventType: 'credential.revoked',
        applicationId: credential.applicationId, credentialId: credential.id, metadata: { prefix: credential.prefix },
      }, session)
      return { credential, changed: true }
    })
  }

  async rotateCredential(
    id: string,
    clampedExpiry: Date,
    now: Date,
    actorId: string,
    replacement: ConsumerCredentialRecord,
  ): Promise<{ rotated: ConsumerCredentialRecord; changed: boolean } | null> {
    if (!Types.ObjectId.isValid(id)) return null
    return this.inTransaction(async (session) => {
      const changed = await this.credentials.findOneAndUpdate(
        { _id: id, status: 'active' },
        { $set: { expiresAt: clampedExpiry, updatedAt: now } },
        { new: true, session },
      ).lean()
      if (!changed) {
        const existing = await this.credentials.findById(id).session(session).lean()
        return existing ? { rotated: this.toCredential(existing), changed: false } : null
      }
      const rotated = this.toCredential(changed)
      await this.credentials.create([{ _id: replacement.id, ...replacement, updatedAt: now }], { session })
      await this.applications.updateOne(
        { _id: rotated.applicationId }, { $inc: { credentialsRevision: 1 }, $set: { updatedAt: now } }, { session },
      )
      await appendAuditEvent(this.audits, {
        actorId, requestId: this.requestId, eventKey: `credential:${rotated.id}:rotated`, eventType: 'credential.rotated',
        applicationId: rotated.applicationId, credentialId: rotated.id,
        metadata: { prefix: rotated.prefix, replacementPrefix: replacement.prefix, overlapUntil: clampedExpiry.toISOString() },
      }, session)
      return { rotated, changed: true }
    })
  }

  async applicationRevision(applicationId: string): Promise<number> {
    const document = await this.applications.findById(applicationId).lean()
    return document ? Number(document.credentialsRevision ?? 0) : -1
  }

  private toCredential(document: Record<string, unknown>): ConsumerCredentialRecord {
    return {
      id: String(document._id), applicationId: String(document.applicationId), name: String(document.name), prefix: String(document.prefix),
      secretHash: String(document.secretHash), issueIdempotencyKey: String(document.issueIdempotencyKey), scopes: document.scopes as ConsumerCredentialRecord['scopes'], status: document.status as ConsumerCredentialRecord['status'],
      createdAt: new Date(document.createdAt as string), createdBy: String(document.createdBy),
      expiresAt: document.expiresAt ? new Date(document.expiresAt as string) : null,
      revokedAt: document.revokedAt ? new Date(document.revokedAt as string) : null,
      revokedBy: document.revokedBy ? String(document.revokedBy) : null,
    }
  }
}
