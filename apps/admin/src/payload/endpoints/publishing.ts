import type { Endpoint, PayloadRequest } from 'payload'
import type { CmsIdentity } from '../../auth/fastapi-authz-client'
import { AdminHttpError } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'
import { enqueuePublish, restoreVersionAsDraft } from '../../publishing/publish-collection'
import { getPublishPreview } from '../../publishing/publish-preview'

function collectionId(request: PayloadRequest): string {
  const id = request.routeParams?.id
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw new AdminHttpError(404, 'not_found')
  return id
}

function ifMatch(headers: Headers): number {
  const raw = headers.get('if-match')?.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  if (!raw || !/^\d+$/.test(raw)) throw new AdminHttpError(412, 'precondition_failed')
  return Number(raw)
}

async function requestBody(request: Request): Promise<{ confirmUnavailable?: unknown; expectedUnavailableCount?: unknown }> {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    const record = value as Record<string, unknown>
    const permitted = new Set(['confirmUnavailable', 'expectedUnavailableCount'])
    if (Object.keys(record).some((key) => !permitted.has(key))) throw new Error('invalid')
    return record
  } catch {
    throw new AdminHttpError(400, 'invalid_request')
  }
}

function guard(handler: (request: PayloadRequest, actor: CmsIdentity) => Promise<Response>) {
  const guarded = withAdmin((request, actor) => handler(request as unknown as PayloadRequest, actor))
  return (request: PayloadRequest) => guarded(request as unknown as Request)
}

export function publishingEndpoints({
  preview = getPublishPreview,
}: {
  preview?: typeof getPublishPreview
} = {}): Endpoint[] {
  return [
    {
      method: 'get', path: '/admin/v1/collections/:id/publish-preview',
      handler: guard(async (request, actor) => Response.json(await preview(request.payload, {
        collectionId: collectionId(request),
        actorId: actor.user_id,
      }))),
    },
    {
      method: 'post', path: '/admin/v1/collections/:id/publish',
      handler: guard(async (request, actor) => {
        const value = await requestBody(request as unknown as Request)
        const idempotencyKey = request.headers.get('idempotency-key')?.trim()
        const requestId = request.headers.get('x-request-id')?.trim()
        const expectedUnavailableCount = value.expectedUnavailableCount
        if (!idempotencyKey || !requestId || typeof value.confirmUnavailable !== 'boolean' ||
          (expectedUnavailableCount !== undefined &&
            (typeof expectedUnavailableCount !== 'number' || !Number.isInteger(expectedUnavailableCount) || expectedUnavailableCount < 0))) {
          throw new AdminHttpError(400, 'invalid_request')
        }
        const job = await enqueuePublish(request.payload, {
          collectionId: collectionId(request), ifMatch: ifMatch(request.headers), idempotencyKey, requestId,
          actorId: actor.user_id, confirmUnavailable: value.confirmUnavailable,
          expectedUnavailableCount: expectedUnavailableCount as number | undefined,
        })
        return Response.json(job, { status: 202 })
      }),
    },
    {
      method: 'post', path: '/admin/v1/collections/:id/versions/:version/restore-as-draft',
      handler: guard(async (request, actor) => {
        const requestId = request.headers.get('x-request-id')?.trim()
        const rawVersion = request.routeParams?.version
        const version = typeof rawVersion === 'string' && /^\d+$/.test(rawVersion) ? Number(rawVersion) : NaN
        if (!requestId || !Number.isInteger(version) || version < 1) throw new AdminHttpError(400, 'invalid_request')
        const result = await restoreVersionAsDraft(request.payload, {
          collectionId: collectionId(request), version, actorId: actor.user_id, requestId,
        })
        return Response.json(result, { status: 200 })
      }),
    },
  ]
}
