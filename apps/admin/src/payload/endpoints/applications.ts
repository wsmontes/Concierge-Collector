import type { Endpoint, PayloadRequest } from 'payload'
import { Types } from 'mongoose'
import { issueCredential, revokeCredential } from '../../applications/credentials'
import { PayloadCredentialRepository } from '../../applications/repository'
import { ConsumerApplicationService, type ConsumerApplicationInput } from '../../applications/service'
import type { ConsumerCredentialScope, IssueCredentialCommand } from '../../applications/types'
import { AdminHttpError } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'

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

function ifMatch(headers: Headers): number {
  const value = headers.get('if-match')?.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  if (!value || !/^\d+$/.test(value) || Number(value) < 1) throw new AdminHttpError(412, 'precondition_failed')
  return Number(value)
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as Record<string, unknown>
  } catch { throw new AdminHttpError(400, 'invalid_request') }
}

function applicationInput(value: Record<string, unknown>): ConsumerApplicationInput {
  const permitted = new Set(['name', 'owner', 'status', 'allowedCollectionIds', 'defaultRequestsPerMinute'])
  if (Object.keys(value).some((key) => !permitted.has(key)) ||
      (value.name !== undefined && typeof value.name !== 'string') ||
      (value.owner !== undefined && typeof value.owner !== 'string') ||
      (value.status !== undefined && typeof value.status !== 'string') ||
      (value.allowedCollectionIds !== undefined && (!Array.isArray(value.allowedCollectionIds) || value.allowedCollectionIds.some((id) => typeof id !== 'string'))) ||
      (value.defaultRequestsPerMinute !== undefined && !Number.isInteger(value.defaultRequestsPerMinute))) throw new AdminHttpError(400, 'invalid_request')
  return value as ConsumerApplicationInput
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

/** Admin-only application and show-once credential command surface. */
export function applicationEndpoints(): Endpoint[] {
  return [
    { method: 'get', path: '/admin/v1/applications', handler: guarded(async (request) => Response.json({ items: await new ConsumerApplicationService(request.payload).list() })) },
    { method: 'post', path: '/admin/v1/applications', handler: guarded(async (request, actorId) => {
      const context = commandContext(request.headers, actorId)
      return Response.json(await new ConsumerApplicationService(request.payload).create(applicationInput(await body(request as unknown as Request)), context), { status: 201 })
    }) },
    { method: 'patch', path: '/admin/v1/applications/:id', handler: guarded(async (request, actorId) => {
      const context = commandContext(request.headers, actorId)
      return Response.json(await new ConsumerApplicationService(request.payload).patch(routeId(request), ifMatch(request.headers), applicationInput(await body(request as unknown as Request)), context))
    }) },
    { method: 'post', path: '/admin/v1/applications/:id/credentials', handler: guarded(async (request, actorId) => {
      const context = commandContext(request.headers, actorId)
      const applicationId = routeId(request)
      const existing = request.payload.db.collections['consumer-credentials']
      if (!existing) throw new Error('Missing CMS collection model: consumer-credentials')
      const duplicate = await (existing as { findOne(query: Record<string, unknown>): { lean(): Promise<unknown> } }).findOne({ applicationId, issueIdempotencyKey: context.idempotencyKey }).lean()
      // The raw secret can never be replayed. A repeated request must be
      // resolved by issuing a new credential deliberately, not silently.
      if (duplicate) throw new AdminHttpError(409, 'unavailable_confirmation_required')
      const result = await issueCredential(issueInput(await body(request as unknown as Request), applicationId, actorId, context.idempotencyKey), new PayloadCredentialRepository(request.payload, actorId, context.requestId))
      return Response.json({ credential: result.credential, secret_once: result.secretOnce }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
    }) },
    { method: 'post', path: '/admin/v1/credentials/:id/revoke', handler: guarded(async (request, actorId) => {
      const requestId = request.headers.get('x-request-id')?.trim()
      if (!requestId) throw new AdminHttpError(400, 'invalid_request')
      return Response.json(await revokeCredential(routeId(request), actorId, new PayloadCredentialRepository(request.payload, actorId, requestId)))
    }) },
  ]
}
