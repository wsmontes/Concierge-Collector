import type { Endpoint, PayloadRequest } from 'payload'
import { CurationAdapter, type SearchCurationsInput } from '../../fastapi/curation-adapter'
import { normalizeCurationFilters } from '../../explorer/normalize-filters'
import { AdminHttpError, adminErrorResponse } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'

type CatalogSearch = Pick<CurationAdapter, 'search'>

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

/** Browser BFF for the Explorer. It always derives actor and service credentials server-side. */
export function explorerEndpoints(adapterForRequest: (request: PayloadRequest) => CatalogSearch = () => new CurationAdapter()): Endpoint[] {
  return [{
    method: 'get', path: '/admin/v1/curations',
    handler: (request: PayloadRequest) => withAdmin(async (adminRequest, actor) => {
      try {
        return Response.json(await adapterForRequest(request).search(searchInput(request, actor.user_id)))
      } catch (error) {
        return adminErrorResponse(error)
      }
    })(request as unknown as Request),
  }]
}
