import type { Endpoint, PayloadRequest } from 'payload'
import type { CmsIdentity } from '../../auth/fastapi-authz-client'
import { AdminHttpError } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'
import { cancelDraftOperation } from '../../operations/apply-draft-operation'
import { enqueueDraftOperation } from '../../operations/enqueue'

function routeId(request: PayloadRequest, key = 'id'): string {
  const id = request.routeParams?.[key]
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw new AdminHttpError(404, 'not_found')
  return id
}

function parseIfMatch(headers: Headers): number {
  const value = headers.get('if-match')?.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  if (!value || !/^\d+$/.test(value)) throw new AdminHttpError(412, 'precondition_failed')
  return Number(value)
}

async function body(request: Request): Promise<{ action?: unknown; curationIds?: unknown }> {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as { action?: unknown; curationIds?: unknown }
  } catch {
    throw new AdminHttpError(400, 'invalid_request')
  }
}

function guard(handler: (request: PayloadRequest, actor: CmsIdentity) => Promise<Response>) {
  const guarded = withAdmin((request, actor) => handler(request as unknown as PayloadRequest, actor))
  return (request: PayloadRequest) => guarded(request as unknown as Request)
}

function operationModels(request: PayloadRequest) {
  const model = request.payload.db.collections['collection-operations']
  if (!model) throw new Error('Missing collection operations model')
  return model as unknown as { findById(id: string): { lean(): Promise<unknown> } }
}

/** Command API for operations. Native Payload writes remain deny-by-default. */
export function operationEndpoints(): Endpoint[] {
  return [
    {
      method: 'post', path: '/admin/v1/collections/:id/draft/operations',
      handler: guard(async (request, actor) => {
        const value = await body(request as unknown as Request)
        const key = request.headers.get('idempotency-key')?.trim()
        const requestId = request.headers.get('x-request-id')?.trim()
        if (!key || !requestId || (value.action !== 'add' && value.action !== 'remove') || !Array.isArray(value.curationIds)) {
          throw new AdminHttpError(400, 'invalid_request')
        }
        const operation = await enqueueDraftOperation(request.payload, {
          collectionId: routeId(request), action: value.action, curationIds: value.curationIds,
          baseDraftRevision: parseIfMatch(request.headers), idempotencyKey: key, actorId: actor.user_id, requestId,
        })
        return Response.json(operation, { status: 202 })
      }),
    },
    {
      method: 'get', path: '/admin/v1/operations/:id',
      handler: guard(async (request) => {
        const value = await operationModels(request).findById(routeId(request)).lean()
        if (!value) throw new AdminHttpError(404, 'not_found')
        return Response.json({ ...(value as Record<string, unknown>), id: String((value as Record<string, unknown>).id ?? (value as Record<string, unknown>)._id) })
      }),
    },
    {
      method: 'post', path: '/admin/v1/operations/:id/cancel',
      handler: guard(async (request) => Response.json(await cancelDraftOperation(request.payload, routeId(request)))),
    },
  ]
}
