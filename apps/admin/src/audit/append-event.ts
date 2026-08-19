import type { ClientSession, Model } from 'mongoose'

export interface AppendAuditEventInput {
  actorId: string
  afterRevision?: number
  beforeRevision?: number
  collectionId: string
  eventKey: string
  eventType: string
  metadata: Record<string, unknown>
  operationId?: string
  publicationJobId?: string
  requestId: string
}

type AuditModel = Model<Record<string, unknown>>

/**
 * Adds one immutable audit document. A duplicate event key deliberately raises
 * so its enclosing transaction rolls back instead of applying a second command.
 */
export async function appendAuditEvent(
  auditEvents: AuditModel,
  input: AppendAuditEventInput,
  session?: ClientSession,
): Promise<void> {
  const now = new Date()
  await auditEvents.create([{ ...input, createdAt: now, updatedAt: now }], { session })
}
