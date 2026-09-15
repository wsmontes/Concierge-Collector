import type { Endpoint, PayloadRequest } from 'payload'
import type { Model } from 'mongoose'
import { CurationAdapter, type SearchCurationsInput } from '../../fastapi/curation-adapter'
import { liveMemberCurationIds, MEMBER_CURATION_ID_LIMIT } from '../../collections/membership-ledger'
import { normalizeCurationFilters } from '../../explorer/normalize-filters'
import { parseWhereClauses } from '../../explorer/url-state'
import { isCurationSort } from '../../explorer/types'
import { summariesRowsFor, withoutCollectionsPage } from '../../explorer/without-collections'
import { AdminHttpError, adminErrorResponse } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'
import { RecordsAdapter } from '../../records/client'

type CatalogSearch = Pick<CurationAdapter, 'search' | 'scanPage' | 'startScan'>
type CurationRows = Pick<RecordsAdapter, 'curationSummaries'>
type DocumentModel = Model<Record<string, unknown>>

const VIEW_FIELDS = new Set(['name', 'normalizedFilters', 'sort', 'visibleColumns'])

function url(request: PayloadRequest): URL {
  return new URL((request as unknown as Request).url)
}

const SEARCH_KEYS = new Set(['q', 'status', 'city', 'entity_type', 'curator_id', 'unlinked', 'without_collections', 'cursor', 'limit', 'sort', 'where'])
const CONCEPT_PREFIX = 'concept.'

/**
 * The listing mode: `without_collections=true` asks for the Curations no
 * Collection currently holds. It is read separately from the base listing
 * filters because the boundary never receives it — the CMS membership ledger
 * supplies the exclusion this view is built from.
 */
function withoutCollectionsMode(request: PayloadRequest): boolean {
  return url(request).searchParams.get('without_collections') === 'true'
}

/**
 * Live member Curation ids of the membership ledger. A caller holding more than
 * the boundary's per-call bound cannot describe the set at all, so the view is
 * refused instead of being computed from a partial one.
 */
async function exclusionIds(request: PayloadRequest): Promise<string[]> {
  const members = await liveMemberCurationIds(modelFor(request, 'collection-memberships'))
  if (members.length > MEMBER_CURATION_ID_LIMIT) throw new AdminHttpError(503, 'service_unavailable')
  return members
}

function searchInput(request: PayloadRequest, actorId: string): SearchCurationsInput {
  const params = url(request).searchParams
  const isConcept = (key: string): boolean => key.startsWith(CONCEPT_PREFIX) && key.length > CONCEPT_PREFIX.length
  if ([...params.keys()].some((key) => !SEARCH_KEYS.has(key) && !isConcept(key))) {
    throw new AdminHttpError(400, 'invalid_request')
  }
  const rawLimit = params.get('limit') ?? '100'
  const limit = Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new AdminHttpError(400, 'invalid_request')
  const sort = params.get('sort')
  if (sort !== null && !isCurationSort(sort)) throw new AdminHttpError(400, 'invalid_request')
  const concepts = [...params.entries()]
    .filter(([key]) => isConcept(key))
    .map(([key, value]) => ({ category: key.slice(CONCEPT_PREFIX.length), value }))
  // Advanced conditions travel verbatim: the UI owns their serialization, and a
  // clause the catalog boundary refuses is its 422 to report, not a 400 here.
  const where = parseWhereClauses(params.getAll('where'))
  return {
    actorId,
    cursor: params.get('cursor'),
    filters: normalizeCurationFilters({
      q: params.get('q'), status: params.getAll('status'), city: params.get('city'),
      entity_type: params.get('entity_type'), curator_id: params.get('curator_id'),
      unlinked: params.get('unlinked') === 'true', concepts,
    }, where),
    limit,
    ...(sort ? { sort } : {}),
  }
}

/**
 * How many Collections currently hold each Curation of the page.
 *
 * Collections are CMS records, so this answer comes from the CMS membership
 * ledger (a row is current while `removedInVersion` is null) instead of a
 * cross-service call — one query per page, never one per row.
 */
async function collectionsCounts(request: PayloadRequest, curationIds: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (curationIds.length === 0) return counts
  const rows = await modelFor(request, 'collection-memberships')
    .find({ curationId: { $in: [...curationIds] }, removedInVersion: null })
    .select({ curationId: 1 })
    .lean() as Record<string, unknown>[]
  for (const row of rows) {
    const id = String(row.curationId)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
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
export function explorerEndpoints(
  adapterForRequest: (request: PayloadRequest) => CatalogSearch = () => new CurationAdapter(),
  rowsAdapterForRequest: (request: PayloadRequest) => CurationRows = () => new RecordsAdapter(),
): Endpoint[] {
  return [
    ...curationViewEndpoints(),
    {
      method: 'get', path: '/admin/v1/curations',
      handler: (request: PayloadRequest) => withAdmin(async (adminRequest, actor) => {
        try {
          const input = searchInput(request, actor.user_id)
          if (withoutCollectionsMode(request)) {
            const catalog = adapterForRequest(request)
            const summaries = rowsAdapterForRequest(request)
            return Response.json(await withoutCollectionsPage({
              actorId: input.actorId,
              cursor: input.cursor,
              filters: input.filters,
              limit: input.limit,
              memberCurationIds: await exclusionIds(request),
              rowsFor: summariesRowsFor(async (ids, actorId) => (await summaries.curationSummaries(ids, actorId)).items),
              scan: catalog,
              ...(input.sort ? { sort: input.sort } : {}),
            }))
          }
          const page = await adapterForRequest(request).search(input)
          const counts = await collectionsCounts(request, page.items.map((row) => row.curation_id))
          return Response.json({
            ...page,
            items: page.items.map((row) => ({ ...row, collections_count: counts.get(row.curation_id) ?? 0 })),
          })
        } catch (error) {
          return adminErrorResponse(error)
        }
      })(request as unknown as Request),
    },
  ]
}
