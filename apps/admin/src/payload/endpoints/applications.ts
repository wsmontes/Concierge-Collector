import type { Endpoint, PayloadRequest } from 'payload'
import { Types } from 'mongoose'
import { ConsumerApplicationService, type ConsumerApplicationInput } from '../../applications/service'
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

function credentialPublic(value: Record<string, unknown>) {
  return {
    id: String(value._id),
    applicationId: String(value.applicationId),
    name: value.name,
    prefix: value.prefix,
    scopes: value.scopes,
    status: value.status,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt ?? null,
    revokedAt: value.revokedAt ?? null,
    lastUsedAt: value.lastUsedAt ?? null,
  }
}

/**
 * Admin-only application surface. Credential issue/rotate/revoke routes
 * live in `payload/endpoints/credentials.ts` (moved without behavior
 * changes); only the read-only credential listing stays here because it
 * is scoped to an application.
 */
export function applicationEndpoints(): Endpoint[] {
  return [
    { method: 'get', path: '/admin/v1/applications', handler: guarded(async (request) => Response.json({ items: await new ConsumerApplicationService(request.payload).list() })) },
    { method: 'get', path: '/admin/v1/applications/:id/credentials', handler: guarded(async (request) => {
      const applicationId = routeId(request)
      const applications = request.payload.db.collections['consumer-applications']
      const credentials = request.payload.db.collections['consumer-credentials']
      if (!applications || !credentials) throw new Error('Missing CMS application models')
      const application = await (applications as { exists(query: Record<string, unknown>): Promise<unknown> }).exists({ _id: applicationId })
      if (!application) throw new AdminHttpError(404, 'not_found')
      const documents = await (credentials as { find(query: Record<string, unknown>, projection: Record<string, unknown>): { sort(sort: Record<string, number>): { lean(): Promise<Record<string, unknown>[]> } } }).find(
        { applicationId },
        { secretHash: 0, issueIdempotencyKey: 0, createdBy: 0, revokedBy: 0 },
      ).sort({ createdAt: -1 }).lean()
      return Response.json({ items: documents.map(credentialPublic) }, { headers: { 'Cache-Control': 'private, no-store' } })
    }) },
    { method: 'post', path: '/admin/v1/applications', handler: guarded(async (request, actorId) => {
      const context = commandContext(request.headers, actorId)
      return Response.json(await new ConsumerApplicationService(request.payload).create(applicationInput(await body(request as unknown as Request)), context), { status: 201 })
    }) },
    { method: 'patch', path: '/admin/v1/applications/:id', handler: guarded(async (request, actorId) => {
      const context = commandContext(request.headers, actorId)
      return Response.json(await new ConsumerApplicationService(request.payload).patch(routeId(request), ifMatch(request.headers), applicationInput(await body(request as unknown as Request)), context))
    }) },
  ]
}
