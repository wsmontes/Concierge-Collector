import type { Endpoint, PayloadRequest } from 'payload'
import type { Model } from 'mongoose'
import type { EntityListPage } from '@concierge/fastapi-client'
import type { CmsIdentity } from '../../auth/fastapi-authz-client'
import { CurationAdapter } from '../../fastapi/curation-adapter'
import { AdminHttpError } from '../../http/errors'
import { withAdmin, type AdminRequest } from '../../http/with-admin'
import { RecordsAdapter, type EntityPageInput, type SaveRecordInput } from '../../records/client'

type DocumentModel = Model<Record<string, unknown>>

/**
 * The guarded request is both: Payload fills the route params, `withAdmin`
 * proves the CMS session, and the live actor arrives as the handler's second
 * argument — the house convention every other endpoint factory follows.
 */
type AdminRecordRequest = AdminRequest & PayloadRequest

function url(request: AdminRecordRequest): URL {
  return new URL((request as unknown as Request).url)
}

function modelFor(request: AdminRecordRequest, slug: string): DocumentModel {
  const model = request.payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

/** Domain ids are opaque (`cur_…`, `rest_…`): no ObjectId shape to enforce here. */
function recordId(request: AdminRecordRequest): string {
  const id = request.routeParams?.id
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) throw new AdminHttpError(404, 'not_found')
  return id
}

function numberParam(request: AdminRecordRequest, name: string, fallback: number, max: number): number {
  const raw = url(request).searchParams.get(name)
  if (raw === null || raw.length === 0) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > max) throw new AdminHttpError(400, 'invalid_request')
  return value
}

/**
 * Optional query value: absent, whitespace-only and over-long all resolve the
 * same way here as they do in the Explorer's filter normalization — a blank
 * search term is not a search term.
 */
function optionalParam(request: AdminRecordRequest, name: string, max: number): string | null {
  const raw = url(request).searchParams.get(name)?.trim()
  if (raw === undefined || raw.length === 0) return null
  if (raw.length > max) throw new AdminHttpError(400, 'invalid_request')
  return raw
}

/** A typed query is text, not a pattern: regex metacharacters match themselves. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

/** The optimistic-lock write contract shared by both record families. */
function saveInput(value: Record<string, unknown>, recordIdValue: string, actorId: string, role: string): SaveRecordInput {
  const updates = value.updates
  const expectedVersion = value.expectedVersion
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new AdminHttpError(400, 'invalid_request')
  if (Object.keys(updates).length === 0) throw new AdminHttpError(400, 'invalid_request')
  if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 1) throw new AdminHttpError(400, 'invalid_request')
  return {
    actorId,
    role,
    recordId: recordIdValue,
    updates: updates as Record<string, unknown>,
    expectedVersion: expectedVersion as number,
  }
}

/**
 * Which Collections currently hold this Curation.
 *
 * Collections live in the CMS database, so this answer comes from the CMS's own
 * membership ledger (a row is current while `removedInVersion` is null) rather
 * than from a cross-service call.
 */
async function collectionLinks(request: AdminRecordRequest, curationId: string) {
  const memberships = await modelFor(request, 'collection-memberships')
    .find({ curationId, removedInVersion: null })
    .lean() as Record<string, unknown>[]
  const ids = memberships.map((membership) => String(membership.collectionId))
  if (ids.length === 0) return []
  const collections = await modelFor(request, 'collections')
    .find({ _id: { $in: ids } })
    .select({ slug: 1, title: 1, currentPublishedVersion: 1 })
    .lean() as Record<string, unknown>[]
  const byId = new Map(collections.map((collection) => [String(collection._id), collection]))
  return ids.flatMap((id) => {
    const collection = byId.get(id)
    if (!collection) return []
    return [{
      collection_id: id,
      slug: String(collection.slug ?? ''),
      title: String(collection.title ?? ''),
      current_published_version: typeof collection.currentPublishedVersion === 'number'
        ? collection.currentPublishedVersion
        : null,
    }]
  })
}

/**
 * CMS-local Collection hits for the palette: the two editorial handles a
 * person types — `title` and `slug` — matched without case and with the query
 * escaped, bounded by the same page size as the other two record families.
 * Collections have no boundary search of their own, so this reads the CMS
 * database the palette is already served from.
 */
async function collectionHits(request: AdminRecordRequest, query: string, limit: number) {
  const pattern = new RegExp(escapeRegExp(query), 'i')
  const rows = await modelFor(request, 'collections')
    .find({ $or: [{ title: pattern }, { slug: pattern }] })
    .select({ slug: 1, title: 1, lifecycle: 1, draftSelectedCount: 1 })
    .limit(limit)
    .lean() as Record<string, unknown>[]
  return rows.map((row) => ({
    id: String(row._id),
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    lifecycle: String(row.lifecycle ?? ''),
    draftSelectedCount: typeof row.draftSelectedCount === 'number' ? row.draftSelectedCount : 0,
  }))
}

/** Membership rows read for one Entity page: the ledger read is bounded, the corpus is not. */
const ENTITY_MEMBERSHIP_LIMIT = 10_000

/**
 * The Curation ids the boundary reported for one Entity row, or `null` when it
 * reported none. `null` is unknown — an older boundary, a row without the
 * field — and is deliberately not an empty list, which is a known zero.
 */
function curationIdsOf(row: Record<string, unknown>): string[] | null {
  const value = row.curation_ids
  if (!Array.isArray(value)) return null
  return value.filter((id): id is string => typeof id === 'string')
}

/**
 * How many Collections currently hold each Entity of the page.
 *
 * Collections are CMS records, so this answer comes from the CMS's own
 * membership ledger (a row is current while `removedInVersion` is null)
 * instead of a cross-service call — one query for the page, never one per row,
 * exactly like the Explorer's `collectionsCounts`. The boundary supplies each
 * row's Curation ids; they are a join input only and never reach the browser.
 * A row the boundary did not describe gets `null`: unknown, which is not the
 * same as zero.
 */
async function entityCollectionsCounts(
  request: AdminRecordRequest,
  rows: readonly Record<string, unknown>[],
): Promise<(number | null)[]> {
  const idsByRow = rows.map(curationIdsOf)
  const curationIds = [...new Set(idsByRow.flatMap((ids) => ids ?? []))]
  const collectionsByCuration = new Map<string, Set<string>>()
  if (curationIds.length > 0) {
    const memberships = await modelFor(request, 'collection-memberships')
      .find({ curationId: { $in: curationIds }, removedInVersion: null })
      .select({ curationId: 1, collectionId: 1 })
      .limit(ENTITY_MEMBERSHIP_LIMIT)
      .lean() as Record<string, unknown>[]
    for (const membership of memberships) {
      const curationId = String(membership.curationId)
      const collections = collectionsByCuration.get(curationId) ?? new Set<string>()
      collections.add(String(membership.collectionId))
      collectionsByCuration.set(curationId, collections)
    }
  }
  return idsByRow.map((ids) => {
    if (ids === null) return null
    const collections = new Set<string>()
    for (const id of ids) {
      for (const collectionId of collectionsByCuration.get(id) ?? []) collections.add(collectionId)
    }
    return collections.size
  })
}

/**
 * The Entity row the browser receives: the page's Curation ids stay on the
 * server, where the membership join happened, and never reach the browser
 * contract.
 */
function browserEntityRow(row: Record<string, unknown>, collectionsCount: number | null): Record<string, unknown> {
  return { ...withoutBoundaryJoinInput(row), collections_count: collectionsCount }
}

/**
 * Drops the boundary-only join input (`curation_ids`) from one Entity row. The
 * global palette serves the same boundary rows, so it strips them too.
 */
function withoutBoundaryJoinInput(row: Record<string, unknown>): Record<string, unknown> {
  const visible: Record<string, unknown> = { ...row }
  delete visible.curation_ids
  return visible
}

function guard(handler: (request: AdminRecordRequest, actor: CmsIdentity) => Promise<Response>) {
  const protectedHandler = withAdmin((request, actor) => handler(request as AdminRecordRequest, actor))
  return (request: PayloadRequest) => protectedHandler(request as unknown as Request)
}

/**
 * Browser BFF for the editorial record surfaces. Reads return the complete
 * stored document; writes carry the actor the CMS session already proved and
 * an explicit expected version, so the domain's optimistic lock stays the only
 * way to move a record forward.
 */
export function recordEndpoints(
  adapterForRequest: (request: AdminRecordRequest) => RecordsAdapter = () => new RecordsAdapter(),
  searchAdapterForRequest: (request: AdminRecordRequest) => Pick<CurationAdapter, 'search'> = () => new CurationAdapter(),
): Endpoint[] {
  return [
    {
      method: 'get', path: '/admin/v1/records/curations/:id',
      handler: guard(async (adminRequest, actor) => {
        const id = recordId(adminRequest)
        const record = await adapterForRequest(adminRequest).curationRecord(id, actor.user_id)
        return Response.json({ record, collections: await collectionLinks(adminRequest, id) })
      }),
    },
    {
      method: 'patch', path: '/admin/v1/records/curations/:id',
      handler: guard(async (adminRequest, actor) => {
        const id = recordId(adminRequest)
        const { role, user_id: actorId } = actor
        const input = saveInput(await body(adminRequest), id, actorId, role)
        return Response.json({ record: await adapterForRequest(adminRequest).saveCuration(input) })
      }),
    },
    {
      method: 'get', path: '/admin/v1/records/entities',
      handler: guard(async (adminRequest, actor) => {
        const input: EntityPageInput = {
          actorId: actor.user_id,
          query: optionalParam(adminRequest, 'q', 200),
          type: optionalParam(adminRequest, 'type', 80),
          status: optionalParam(adminRequest, 'status', 40),
          afterId: optionalParam(adminRequest, 'cursor', 200),
          limit: numberParam(adminRequest, 'limit', 50, 200),
        }
        const page: EntityListPage = await adapterForRequest(adminRequest).entityPage(input)
        const rows = page.items as unknown as Record<string, unknown>[]
        const counts = await entityCollectionsCounts(adminRequest, rows)
        return Response.json({
          ...page,
          items: rows.map((row, index) => browserEntityRow(row, counts[index])),
        })
      }),
    },
    {
      method: 'get', path: '/admin/v1/records/entities/:id',
      handler: guard(async (adminRequest, actor) => {
        const id = recordId(adminRequest)
        const record = await adapterForRequest(adminRequest).entityRecord(id, actor.user_id)
        return Response.json({ record })
      }),
    },
    {
      method: 'get', path: '/admin/v1/records/entities/:id/curations',
      handler: guard(async (adminRequest, actor) => {
        const id = recordId(adminRequest)
        const limit = numberParam(adminRequest, 'limit', 50, 100)
        return Response.json(
          await adapterForRequest(adminRequest).entityCurations(id, actor.user_id, limit),
        )
      }),
    },
    {
      method: 'patch', path: '/admin/v1/records/entities/:id',
      handler: guard(async (adminRequest, actor) => {
        const id = recordId(adminRequest)
        const { role, user_id: actorId } = actor
        const input = saveInput(await body(adminRequest), id, actorId, role)
        return Response.json({ record: await adapterForRequest(adminRequest).saveEntity(input) })
      }),
    },
    {
      /**
       * One query, three record families: the palette searches Curations and
       * Entities through the boundary and Collections in the CMS database,
       * which is where Collections live.
       */
      method: 'get', path: '/admin/v1/records/search',
      handler: guard(async (adminRequest, actor) => {
        const query = optionalParam(adminRequest, 'q', 200)
        if (query === null) throw new AdminHttpError(400, 'invalid_request')
        const limit = numberParam(adminRequest, 'limit', 8, 25)
        const [curations, entities, collections] = await Promise.all([
          searchAdapterForRequest(adminRequest).search({
            actorId: actor.user_id,
            cursor: null,
            filters: { q: query },
            limit,
          }),
          adapterForRequest(adminRequest).entityPage({
            actorId: actor.user_id,
            query,
            type: null,
            status: null,
            afterId: null,
            limit,
          }),
          collectionHits(adminRequest, query, limit),
        ])
        return Response.json({
          curations: curations.items,
          entities: entities.items.map((row) => withoutBoundaryJoinInput(row as unknown as Record<string, unknown>)),
          collections,
        })
      }),
    },
  ]
}
