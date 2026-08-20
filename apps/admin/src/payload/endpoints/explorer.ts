import type { Endpoint, PayloadRequest } from 'payload'
import type { Model } from 'mongoose'
import { CurationAdapter, type SearchCurationsInput } from '../../fastapi/curation-adapter'
import { normalizeCurationFilters } from '../../explorer/normalize-filters'
import { AdminHttpError, adminErrorResponse } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'

type CatalogSearch = Pick<CurationAdapter, 'search'>
type DocumentModel = Model<Record<string, unknown>>

const VIEW_FIELDS = new Set(['name', 'normalizedFilters', 'sort', 'visibleColumns'])

function url(request: PayloadRequest): URL {
  return new URL((request as unknown as Request).url)
}

function searchInput(request: PayloadRequest, actorId: string): SearchCurationsInput {
  const params = url(request).searchParams
  const allowed = new Set(['q', 'status', 'city', 'entity_type', 'curator_id', 'cursor', 'limit'])
  if ([...params.keys()].some((key) => !allowed.has(key))) throw new AdminHttpError(400, 'invalid_request')
  const rawLimit = params.get('limit') ?? '100'
  const limit = Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new AdminHttpError(400, 'invalid_request')
  return {
    actorId,
    cursor: params.get('cursor'),
    filters: normalizeCurationFilters({
      q: params.get('q'), status: params.getAll('status'), city: params.get('city'),
      entity_type: params.get('entity_type'), curator_id: params.get('curator_id'),
    }),
    limit,
  }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as Record<string, unknown>
  } catch {
    throw new AdminHttpError(400, 'invalid_request')
  }
}

function modelFor(request: PayloadRequest, slug: string): DocumentModel {
  const model = request.payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

/**
 * Resolves the live admin actor to their cms-users document. The endpoint only
 * ever writes/reads views owned by this resolved id — the browser supplies no
 * owner and the collection-level create access is denied by default.
 */
async function ownerIdFor(request: PayloadRequest, fastapiUserId: string): Promise<string> {
  const user = await modelFor(request, 'cms-users').findOne({ fastapiUserId }).lean()
  if (!user) throw new AdminHttpError(401, 'authentication_required')
  return String(user._id)
}

function viewId(request: PayloadRequest): string {
  const id = request.routeParams?.id
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw new AdminHttpError(404, 'not_found')
  return id
}

function viewInput(value: Record<string, unknown>): {
  name: string
  normalizedFilters: Record<string, unknown> | null
  sort: Record<string, unknown> | null
  visibleColumns: string[] | null
} {
  if (Object.keys(value).some((key) => !VIEW_FIELDS.has(key))) throw new AdminHttpError(400, 'invalid_request')
  const name = value.name
  if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 120) {
    throw new AdminHttpError(400, 'invalid_request')
  }
  const optionalRecord = (key: string): Record<string, unknown> | null => {
    const item = value[key]
    if (item === undefined || item === null) return null
    if (typeof item !== 'object' || Array.isArray(item)) throw new AdminHttpError(400, 'invalid_request')
    return item as Record<string, unknown>
  }
  const visibleColumns = value.visibleColumns
  if (visibleColumns !== undefined && visibleColumns !== null) {
    if (!Array.isArray(visibleColumns) || visibleColumns.some((column) => typeof column !== 'string')) {
      throw new AdminHttpError(400, 'invalid_request')
    }
  }
  return {
    name: name.trim(),
    normalizedFilters: optionalRecord('normalizedFilters'),
    sort: optionalRecord('sort'),
    visibleColumns: visibleColumns === undefined || visibleColumns === null ? null : visibleColumns as string[],
  }
}

function publicView(value: Record<string, unknown>) {
  return {
    id: String(value._id),
    name: value.name,
    normalizedFilters: value.normalizedFilters ?? null,
    sort: value.sort ?? null,
    visibleColumns: value.visibleColumns ?? null,
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
  }
}

/** Private saved views of the Explorer, scoped to the live admin actor. */
function curationViewEndpoints(): Endpoint[] {
  return [
    {
      method: 'get', path: '/admin/v1/curation-views',
      handler: (request: PayloadRequest) => withAdmin(async (_adminRequest, actor) => {
        try {
          const views = await modelFor(request, 'saved-curation-views')
            .find({ owner: await ownerIdFor(request, actor.user_id) })
            .sort({ createdAt: -1 })
            .lean()
          return Response.json({ items: views.map(publicView) })
        } catch (error) { return adminErrorResponse(error) }
      })(request as unknown as Request),
    },
    {
      method: 'post', path: '/admin/v1/curation-views',
      handler: (request: PayloadRequest) => withAdmin(async (adminRequest, actor) => {
        try {
          const doc = await modelFor(request, 'saved-curation-views').create({
            owner: await ownerIdFor(request, actor.user_id),
            ...viewInput(await body(adminRequest)),
          })
          return Response.json(publicView(doc.toObject()), { status: 201 })
        } catch (error) { return adminErrorResponse(error) }
      })(request as unknown as Request),
    },
    {
      method: 'delete', path: '/admin/v1/curation-views/:id',
      handler: (request: PayloadRequest) => withAdmin(async (_adminRequest, actor) => {
        try {
          const id = viewId(request)
          const result = await modelFor(request, 'saved-curation-views').deleteOne({
            _id: id,
            owner: await ownerIdFor(request, actor.user_id),
          })
          if (result.deletedCount !== 1) throw new AdminHttpError(404, 'not_found')
          return Response.json({ id })
        } catch (error) { return adminErrorResponse(error) }
      })(request as unknown as Request),
    },
  ]
}

/** Browser BFF for the Explorer. It always derives actor and service credentials server-side. */
export function explorerEndpoints(adapterForRequest: (request: PayloadRequest) => CatalogSearch = () => new CurationAdapter()): Endpoint[] {
  return [
    ...curationViewEndpoints(),
    {
      method: 'get', path: '/admin/v1/curations',
      handler: (request: PayloadRequest) => withAdmin(async (adminRequest, actor) => {
        try {
          return Response.json(await adapterForRequest(request).search(searchInput(request, actor.user_id)))
        } catch (error) {
          return adminErrorResponse(error)
        }
      })(request as unknown as Request),
    },
  ]
}
