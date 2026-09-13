import type { ContentRecordResponse } from '@concierge/fastapi-client'
import type { Endpoint, PayloadRequest } from 'payload'
import { ContentRecordAdapter } from '../../fastapi/content-adapter'
import { AdminHttpError, adminErrorResponse } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'

/** The whole-record reads and the versioned field write the editorial surfaces need. */
export interface ContentRecordLoader {
  curation(curationId: string): Promise<ContentRecordResponse>
  entity(entityId: string): Promise<ContentRecordResponse>
  patchCuration(
    curationId: string,
    fields: Record<string, unknown>,
    version: number,
    actorId: string,
  ): Promise<ContentRecordResponse>
}

/**
 * Domain ids are opaque strings (`cur_...`, `ent_...`, or a 24-hex ObjectId), so
 * the shape check is deliberately loose: it only keeps path traversal and empty
 * segments out of the upstream URL. A syntactically valid but unknown id is the
 * upstream's 404 to report.
 */
const RECORD_ID = /^[A-Za-z0-9._:-]{1,128}$/

function recordId(request: PayloadRequest): string {
  const id = request.routeParams?.id
  if (typeof id !== 'string' || !RECORD_ID.test(id)) throw new AdminHttpError(404, 'not_found')
  return id
}

/**
 * The editor's version fence. It is required, not optional: without it two
 * editors would silently overwrite each other.
 */
function expectedVersion(request: Request): number {
  const raw = request.headers.get('if-match')?.replace(/^"|"$/g, '')
  const version = raw === null || raw === undefined || raw === '' ? NaN : Number(raw)
  if (!Number.isInteger(version) || version < 1) throw new AdminHttpError(400, 'invalid_request')
  return version
}

async function body(request: Request): Promise<Record<string, unknown>> {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new AdminHttpError(400, 'invalid_request')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AdminHttpError(400, 'invalid_request')

  const fields = (value as Record<string, unknown>).fields
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) throw new AdminHttpError(400, 'invalid_request')
  if (Object.keys(fields).length === 0) throw new AdminHttpError(400, 'invalid_request')
  return fields as Record<string, unknown>
}

/** Browser BFF for a whole Curation/Entity record. Credentials stay server-side. */
export function contentEndpoints(
  adapterForRequest: () => ContentRecordLoader = () => new ContentRecordAdapter(),
): Endpoint[] {
  const curation = withAdmin(async (request) => {
    try {
      return Response.json(await adapterForRequest().curation(recordId(request as unknown as PayloadRequest)))
    } catch (error) {
      return adminErrorResponse(error)
    }
  })

  const entity = withAdmin(async (request) => {
    try {
      return Response.json(await adapterForRequest().entity(recordId(request as unknown as PayloadRequest)))
    } catch (error) {
      return adminErrorResponse(error)
    }
  })

  const patchCuration = withAdmin(async (request, actor) => {
    try {
      const id = recordId(request as unknown as PayloadRequest)
      // The live FastAPI identity is the write actor: the browser never supplies one.
      return Response.json(await adapterForRequest().patchCuration(id, await body(request), expectedVersion(request), actor.email))
    } catch (error) {
      return adminErrorResponse(error)
    }
  })

  return [
    {
      method: 'get',
      path: '/admin/v1/curations/:id',
      handler: (request: PayloadRequest) => curation(request as unknown as Request),
    },
    {
      method: 'patch',
      path: '/admin/v1/curations/:id',
      handler: (request: PayloadRequest) => patchCuration(request as unknown as Request),
    },
    {
      method: 'get',
      path: '/admin/v1/entities/:id',
      handler: (request: PayloadRequest) => entity(request as unknown as Request),
    },
  ]
}
