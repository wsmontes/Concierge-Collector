import type { Endpoint, PayloadRequest } from 'payload'
import { Types } from 'mongoose'
import { issueCredential, revokeCredential, rotateCredential, type RotateCredentialCommand } from '../../applications/credentials'
import { PayloadCredentialRepository } from '../../applications/repository'
import type { ConsumerCredentialScope, IssueCredentialCommand } from '../../applications/types'
import { AdminHttpError } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'

/**
 * Admin-only show-once credential command surface: issue (against an
 * application), rotate with an explicit overlap window and revoke.
 */

function guarded(handler: (request: PayloadRequest, actorId: string) => Promise<Response>) {
  const wrapped = withAdmin((request, actor) => handler(request as unknown as PayloadRequest, actor.user_id))
  return (request: PayloadRequest) => wrapped(request as unknown as Request)
}

function routeId(request: PayloadRequest): string {
  const value = request.routeParams?.id
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw new AdminHttpError(404, 'not_found')
  return value
}

function commandContext(headers: Headers, actorId: string) {
  const idempotencyKey = headers.get('idempotency-key')?.trim()
  const requestId = headers.get('x-request-id')?.trim()
  if (!idempotencyKey || !requestId) throw new AdminHttpError(400, 'invalid_request')
  return { actorId, idempotencyKey, requestId }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as Record<string, unknown>
  } catch { throw new AdminHttpError(400, 'invalid_request') }
}

function issueInput(value: Record<string, unknown>, applicationId: string, actorId: string, idempotencyKey: string): IssueCredentialCommand {
  const permitted = new Set(['name', 'scopes', 'expiresAt'])
  if (Object.keys(value).some((key) => !permitted.has(key)) || typeof value.name !== 'string' || !Array.isArray(value.scopes) || value.scopes.some((scope) => scope !== 'collections:read')) throw new AdminHttpError(400, 'invalid_request')
  let expiresAt: Date | null = null
  if (value.expiresAt !== undefined && value.expiresAt !== null) {
    if (typeof value.expiresAt !== 'string') throw new AdminHttpError(400, 'invalid_request')
    expiresAt = new Date(value.expiresAt)
    if (!Number.isFinite(expiresAt.getTime())) throw new AdminHttpError(400, 'invalid_request')
  }
  return { applicationId, actorId, idempotencyKey, name: value.name, scopes: value.scopes as ConsumerCredentialScope[], expiresAt }
}

function rotateInput(value: Record<string, unknown>, credentialId: string, actorId: string, idempotencyKey: string): RotateCredentialCommand {
  const permitted = new Set(['overlapUntil', 'name', 'scopes', 'expiresAt'])
  if (Object.keys(value).some((key) => !permitted.has(key)) || typeof value.overlapUntil !== 'string') throw new AdminHttpError(400, 'invalid_request')
  const overlapUntil = new Date(value.overlapUntil)
  if (!Number.isFinite(overlapUntil.getTime())) throw new AdminHttpError(400, 'invalid_request')
  const command: RotateCredentialCommand = { credentialId, actorId, idempotencyKey, overlapUntil }
  if (value.name !== undefined) {
    if (typeof value.name !== 'string') throw new AdminHttpError(400, 'invalid_request')
    command.name = value.name
  }
  if (value.scopes !== undefined) {
    if (!Array.isArray(value.scopes) || value.scopes.some((scope) => scope !== 'collections:read')) throw new AdminHttpError(400, 'invalid_request')
    command.scopes = value.scopes as ConsumerCredentialScope[]
  }
  if (value.expiresAt !== undefined && value.expiresAt !== null) {
    if (typeof value.expiresAt !== 'string') throw new AdminHttpError(400, 'invalid_request')
    const expiresAt = new Date(value.expiresAt)
    if (!Number.isFinite(expiresAt.getTime())) throw new AdminHttpError(400, 'invalid_request')
    command.expiresAt = expiresAt
  } else if (value.expiresAt === null) {
    command.expiresAt = null
  }
  return command
}

function credentialsModel(request: PayloadRequest) {
  const model = request.payload.db.collections['consumer-credentials']
  if (!model) throw new Error('Missing CMS collection model: consumer-credentials')
  return model as unknown as {
    findOne(query: Record<string, unknown>): { lean(): Promise<Record<string, unknown> | null> }
  }
}

/** Credential issue/rotate/revoke surface, each guarded and audited. */
export function credentialEndpoints(): Endpoint[] {
  return [
    { method: 'post', path: '/admin/v1/applications/:id/credentials', handler: guarded(async (request, actorId) => {
      const context = commandContext(request.headers, actorId)
      const applicationId = routeId(request)
      const existing = credentialsModel(request)
      const duplicate = await existing.findOne({ applicationId, issueIdempotencyKey: context.idempotencyKey }).lean()
      // The raw secret can never be replayed. A repeated request must be
      // resolved by issuing a new credential deliberately, not silently.
      if (duplicate) throw new AdminHttpError(409, 'unavailable_confirmation_required')
      const result = await issueCredential(issueInput(await body(request as unknown as Request), applicationId, actorId, context.idempotencyKey), new PayloadCredentialRepository(request.payload, actorId, context.requestId))
      return Response.json({ credential: result.credential, secret_once: result.secretOnce }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
    }) },
    { method: 'post', path: '/admin/v1/credentials/:id/rotate', handler: guarded(async (request, actorId) => {
      const context = commandContext(request.headers, actorId)
      const credentialId = routeId(request)
      const existing = credentialsModel(request)
      const source = await existing.findOne({ _id: credentialId }).lean()
      if (!source || typeof source.applicationId !== 'string') throw new AdminHttpError(404, 'not_found')
      // Idempotency uniqueness is per Application. A key used by another
      // consumer Application must not block this rotation.
      const duplicate = await existing.findOne({
        applicationId: source.applicationId,
        issueIdempotencyKey: context.idempotencyKey,
      }).lean()
      if (duplicate) throw new AdminHttpError(409, 'unavailable_confirmation_required')
      const result = await rotateCredential(credentialId, rotateInput(await body(request as unknown as Request), credentialId, actorId, context.idempotencyKey), new PayloadCredentialRepository(request.payload, actorId, context.requestId))
      return Response.json({ credential: result.credential, secret_once: result.secretOnce }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
    }) },
    { method: 'post', path: '/admin/v1/credentials/:id/revoke', handler: guarded(async (request, actorId) => {
      const requestId = request.headers.get('x-request-id')?.trim()
      if (!requestId) throw new AdminHttpError(400, 'invalid_request')
      return Response.json(await revokeCredential(routeId(request), actorId, new PayloadCredentialRepository(request.payload, actorId, requestId)))
    }) },
  ]
}