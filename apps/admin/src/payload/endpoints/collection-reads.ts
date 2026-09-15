import type { Endpoint, PayloadRequest } from 'payload'
import type { Model } from 'mongoose'
import type { AdminCurationRow } from '@concierge/fastapi-client'
import type { CmsIdentity } from '../../auth/fastapi-authz-client'
import { AdminHttpError } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'
import { RecordsAdapter } from '../../records/client'

type DocumentModel = Model<Record<string, unknown>>
type Cursor = { after: string }
type AdminCollectionRequest = PayloadRequest & { actor: CmsIdentity }

/** The one boundary capability these read models need: a batch of editorial rows. */
type SummaryAdapter = Pick<RecordsAdapter, 'curationSummaries'>
type SummaryRow = AdminCurationRow

function modelFor(request: PayloadRequest, slug: string): DocumentModel {
  const model = request.payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function collectionId(request: PayloadRequest): string {
  const id = request.routeParams?.id
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw new AdminHttpError(404, 'not_found')
  return id
}

function url(request: PayloadRequest) { return new URL((request as unknown as Request).url) }

function limit(request: PayloadRequest): number {
  const value = Number(url(request).searchParams.get('limit') ?? '100')
  if (!Number.isInteger(value) || value < 1 || value > 200) throw new AdminHttpError(400, 'invalid_request')
  return value
}

function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor
    if (!parsed || typeof parsed.after !== 'string' || !parsed.after) throw new Error('invalid')
    return parsed
  } catch {
    throw new AdminHttpError(400, 'invalid_request')
  }
}

function encodeCursor(after: string | undefined): string | null {
  return after ? Buffer.from(JSON.stringify({ after }), 'utf8').toString('base64url') : null
}

function guard(handler: (request: AdminCollectionRequest, actor: CmsIdentity) => Promise<Response>) {
  const protectedHandler = withAdmin((request, actor) => handler(request as unknown as AdminCollectionRequest, actor))
  return (request: PayloadRequest) => protectedHandler(request as unknown as Request)
}

/**
 * Editorial rows for one page of members or draft changes.
 *
 * Exactly one boundary call per page — a page with no rows never reaches the
 * boundary at all — and an id the catalog no longer holds stays absent from the
 * returned map, which the caller renders as `null` instead of a fabricated row.
 */
async function summariesFor(
  adapter: SummaryAdapter,
  actorId: string,
  curationIds: readonly string[],
): Promise<Map<string, SummaryRow>> {
  const unique = [...new Set(curationIds)]
  if (unique.length === 0) return new Map()
  const { items } = await adapter.curationSummaries(unique, actorId)
  return new Map(items.map((row) => [String(row.curation_id), row]))
}

/** Read models are cursor-paginated so the browser never receives a full Collection. */
export function collectionReadEndpoints(
  summariesForRequest: (request: AdminCollectionRequest) => SummaryAdapter = () => new RecordsAdapter(),
): Endpoint[] {
  return [
    {
      method: 'get', path: '/admin/v1/collections/:id/members',
      handler: guard(async (request, actor) => {
        const id = collectionId(request)
        const collection = await modelFor(request, 'collections').findById(id).lean() as Record<string, unknown> | null
        if (!collection) throw new AdminHttpError(404, 'not_found')
        const versionParam = url(request).searchParams.get('version')
        const version = versionParam ? Number(versionParam) : Number(collection.currentPublishedVersion)
        if (!Number.isInteger(version) || version < 1) throw new AdminHttpError(400, 'invalid_request')
        const cursor = decodeCursor(url(request).searchParams.get('cursor'))
        const items = await modelFor(request, 'collection-memberships').find({
          collectionId: id, addedInVersion: { $lte: version },
          $or: [{ removedInVersion: null }, { removedInVersion: { $gt: version } }],
          ...(cursor ? { curationId: { $gt: cursor.after } } : {}),
        }).sort({ curationId: 1 }).limit(limit(request) + 1).lean()
        const page = items.slice(0, limit(request)) as Record<string, unknown>[]
        const summaries = await summariesFor(
          summariesForRequest(request),
          actor.user_id,
          page.map((item) => String(item.curationId)),
        )
        return Response.json({
          items: page.map((item) => ({
            curationId: String(item.curationId),
            summary: summaries.get(String(item.curationId)) ?? null,
          })),
          nextCursor: items.length > page.length ? encodeCursor(String(page.at(-1)?.curationId)) : null,
        })
      }),
    },
    {
      method: 'get', path: '/admin/v1/collections/:id/draft/diff',
      handler: guard(async (request, actor) => {
        const id = collectionId(request)
        const collection = await modelFor(request, 'collections').findById(id).lean() as Record<string, unknown> | null
        if (!collection) throw new AdminHttpError(404, 'not_found')
        const desiredState = url(request).searchParams.get('desiredState')
        if (desiredState && desiredState !== 'add' && desiredState !== 'remove') throw new AdminHttpError(400, 'invalid_request')
        const cursor = decodeCursor(url(request).searchParams.get('cursor'))
        const items = await modelFor(request, 'collection-draft-changes').find({
          collectionId: id, draftEpoch: collection.draftEpoch, stageState: 'committed',
          targetDraftRevision: { $lte: collection.draftRevision },
          $or: [{ validUntilDraftRevision: null }, { validUntilDraftRevision: { $gte: collection.draftRevision } }],
          ...(desiredState ? { desiredState } : {}), ...(cursor ? { curationId: { $gt: cursor.after } } : {}),
        }).sort({ curationId: 1, targetDraftRevision: -1 }).limit(limit(request) + 1).lean()
        const seen = new Set<string>()
        const page = (items as Record<string, unknown>[]).filter((item) => !seen.has(String(item.curationId)) && Boolean(seen.add(String(item.curationId)))).slice(0, limit(request))
        const summaries = await summariesFor(
          summariesForRequest(request),
          actor.user_id,
          page.map((item) => String(item.curationId)),
        )
        return Response.json({
          items: page.map((item) => ({
            curationId: String(item.curationId),
            desiredState: item.desiredState,
            operationId: String(item.operationId),
            summary: summaries.get(String(item.curationId)) ?? null,
          })),
          nextCursor: items.length > page.length ? encodeCursor(String(page.at(-1)?.curationId)) : null,
        })
      }),
    },
    {
      method: 'get', path: '/admin/v1/collections/:id/versions',
      handler: guard(async (request) => {
        const id = collectionId(request)
        const cursor = decodeCursor(url(request).searchParams.get('cursor'))
        const items = await modelFor(request, 'collection-versions').find({ collectionId: id, status: 'published', ...(cursor ? { version: { $lt: Number(cursor.after) } } : {}) }).sort({ version: -1 }).limit(limit(request) + 1).lean()
        const page = (items as Record<string, unknown>[]).slice(0, limit(request))
        return Response.json({ items: page.map((item) => ({ version: item.version, selectedCount: item.selectedCount, membershipHash: item.membershipHash, publishedAt: item.publishedAt })), nextCursor: items.length > page.length ? encodeCursor(String(page.at(-1)?.version)) : null })
      }),
    },
    {
      method: 'get', path: '/admin/v1/collections/:id/activity',
      handler: guard(async (request) => {
        const id = collectionId(request)
        const cursor = decodeCursor(url(request).searchParams.get('cursor'))
        const items = await modelFor(request, 'audit-events').find({ collectionId: id, ...(cursor ? { _id: { $lt: cursor.after } } : {}) }).sort({ _id: -1 }).limit(limit(request) + 1).lean()
        const page = (items as Record<string, unknown>[]).slice(0, limit(request))
        return Response.json({ items: page.map((item) => ({ eventType: item.eventType, actorId: item.actorId, createdAt: item.createdAt })), nextCursor: items.length > page.length ? encodeCursor(String(page.at(-1)?._id)) : null })
      }),
    },
  ]
}
