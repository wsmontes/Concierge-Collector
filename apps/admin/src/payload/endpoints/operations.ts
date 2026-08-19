import type { Endpoint, PayloadRequest } from 'payload'
import type { CmsIdentity } from '../../auth/fastapi-authz-client'
import { AdminHttpError } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'
import { authenticateAdminRequest } from '../../auth/authenticate-admin-request'
import { adminErrorResponse } from '../../http/errors'
import { readEnv } from '../../env'
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

type OperationBody = { action?: unknown; curationIds?: unknown; curation_ids?: unknown; draft_revision?: unknown; mode?: unknown }

async function body(request: Request): Promise<OperationBody> {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as OperationBody
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

function readCollectorOrigin(request: PayloadRequest): boolean {
  const origin = request.headers.get('origin')
  return Boolean(origin && readEnv().collectorOrigins.includes(origin))
}

/** Command API for operations. Native Payload writes remain deny-by-default. */
export function operationEndpoints(): Endpoint[] {
  return [
    {
      method: 'post', path: '/admin/v1/collections/:id/draft/operations',
      handler: async (request: PayloadRequest) => {
        try {
        const value = await body(request as unknown as Request)
        if (Object.keys(value).some((key) => !['action', 'curationIds', 'curation_ids', 'draft_revision', 'mode'].includes(key))) throw new AdminHttpError(400, 'invalid_request')
        // The Collector-facing contract is snake_case. Keep camelCase only for
        // already-issued Admin clients while the CMS UI is being introduced.
        if (value.curationIds !== undefined && value.curation_ids !== undefined) throw new AdminHttpError(400, 'invalid_request')
        const curationIds = value.curation_ids ?? value.curationIds
        const key = request.headers.get('idempotency-key')?.trim()
        const requestId = request.headers.get('x-request-id')?.trim()
        const baseDraftRevision = parseIfMatch(request.headers)
        if (!key || !requestId || (value.mode !== undefined && value.mode !== 'explicit') || (value.action !== 'add' && value.action !== 'remove') || !Array.isArray(curationIds) || !Number.isInteger(value.draft_revision) || value.draft_revision !== baseDraftRevision) {
          throw new AdminHttpError(400, 'invalid_request')
        }
        const actor = await authenticateAdminRequest(request as unknown as Request, {
          allowCollectorBearer: true,
          explicitCurationIds: curationIds as string[],
        })
        const operation = await enqueueDraftOperation(request.payload, {
          collectionId: routeId(request), action: value.action, curationIds,
          baseDraftRevision, idempotencyKey: key, actorId: actor.user_id, requestId,
        })
        return Response.json(operation, { status: 202 })
        } catch (error) {
          return adminErrorResponse(error)
        }
      },
    },
    {
      method: 'get', path: '/admin/v1/operations/:id',
      handler: async (request: PayloadRequest) => {
        try {
        const actor = await authenticateAdminRequest(request as unknown as Request, { allowCollectorBearer: true, allowCollectorOperationRead: true })
        const value = await operationModels(request).findById(routeId(request)).lean()
        if (!value) throw new AdminHttpError(404, 'not_found')
        const operation = value as Record<string, unknown>
        const isCollector = readCollectorOrigin(request)
        if (isCollector && (operation.actorId !== actor.user_id || operation.mode !== 'explicit' || operation.selectedCount !== 1)) {
          throw new AdminHttpError(404, 'not_found')
        }
        if (isCollector) return Response.json({ id: String(operation.id ?? operation._id), status: operation.status, progress: operation.progress, errorCode: operation.errorCode ?? null })
        return Response.json({ ...operation, id: String(operation.id ?? operation._id) })
        } catch (error) {
          return adminErrorResponse(error)
        }
      },
    },
    {
      method: 'post', path: '/admin/v1/operations/:id/cancel',
      handler: guard(async (request) => Response.json(await cancelDraftOperation(request.payload, routeId(request)))),
    },
  ]
}
