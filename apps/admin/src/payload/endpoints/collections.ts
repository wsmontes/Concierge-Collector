import type { Endpoint, PayloadRequest } from 'payload'
import type { CmsIdentity } from '../../auth/fastapi-authz-client'
import { createCollectionRepository, type CollectionRepository } from '../../collections/repository'
import type { CollectionMetadataInput } from '../../collections/types'
import { LifecycleDecisionError, normalizeCollectionSlug, normalizeCollectionTitle } from '../../collections/lifecycle'
import { AdminHttpError } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'

type RepositoryFactory = (request: PayloadRequest) => CollectionRepository
const LIST_PAGE_SIZE = 100

function parseIfMatch(headers: Headers): number {
  const value = headers.get('if-match')?.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  if (!value || !/^\d+$/.test(value) || Number(value) < 1) throw new AdminHttpError(412, 'precondition_failed')
  return Number(value)
}

function commandContext(headers: Headers, actor: CmsIdentity) {
  const idempotencyKey = headers.get('idempotency-key')?.trim()
  const requestId = headers.get('x-request-id')?.trim()
  if (!idempotencyKey || !requestId) throw new AdminHttpError(400, 'invalid_request')
  return { actorId: actor.user_id, idempotencyKey, requestId }
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as Record<string, unknown>
  } catch {
    throw new AdminHttpError(400, 'invalid_request')
  }
}

const METADATA_FIELDS = new Set(['slug', 'title', 'description'])

export function metadataFrom(value: Record<string, unknown>, requireCreateFields = false): CollectionMetadataInput {
  const metadata: CollectionMetadataInput = {}
  try {
    if (Object.keys(value).some((key) => !METADATA_FIELDS.has(key))) throw new AdminHttpError(400, 'invalid_request')
    for (const key of ['slug', 'title', 'description'] as const) {
      if (!(key in value)) continue
      const field = value[key]
      if (key === 'description' && field === null) metadata.description = null
      else if (typeof field === 'string') {
        if (key === 'slug') metadata.slug = normalizeCollectionSlug(field)
        else if (key === 'title') metadata.title = normalizeCollectionTitle(field)
        else metadata.description = field
      } else throw new AdminHttpError(400, 'invalid_request')
    }
  } catch (error) {
    if (error instanceof LifecycleDecisionError) throw new AdminHttpError(400, 'invalid_request')
    throw error
  }
  if (requireCreateFields && (!metadata.slug || !metadata.title)) throw new AdminHttpError(400, 'invalid_request')
  if (!requireCreateFields && Object.keys(metadata).length === 0) throw new AdminHttpError(400, 'invalid_request')
  return metadata
}

function routeId(request: PayloadRequest): string {
  const id = request.routeParams?.id
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw new AdminHttpError(404, 'not_found')
  return id
}

function guarded(handler: (request: PayloadRequest, actor: CmsIdentity) => Promise<Response>): (request: PayloadRequest) => Promise<Response> {
  const handlerWithAdmin = withAdmin(async (request, actor) => handler(request as unknown as PayloadRequest, actor))
  return (request) => handlerWithAdmin(request as unknown as Request)
}

function listCursor(request: PayloadRequest): { title: string; id: string } | null {
  let raw: string | null = null
  try { raw = new URL((request as unknown as Request).url).searchParams.get('cursor') } catch { return null }
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { title?: unknown; id?: unknown }
    if (typeof parsed.title !== 'string' || parsed.title.length > 200 || typeof parsed.id !== 'string' || !/^[a-f\d]{24}$/i.test(parsed.id)) throw new Error('invalid')
    return { title: parsed.title, id: parsed.id }
  } catch {
    throw new AdminHttpError(400, 'invalid_request')
  }
}

function encodeListCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify({ title: String(value.title ?? ''), id: String(value.id ?? value._id) }), 'utf8').toString('base64url')
}

function publicCollection(row: unknown) {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id ?? value._id),
    slug: value.slug,
    title: value.title,
    description: value.description ?? null,
    lifecycle: value.lifecycle,
    currentPublishedVersion: value.currentPublishedVersion ?? null,
    draftRevision: value.draftRevision,
    draftState: value.draftState,
    publishedSelectedCount: value.publishedSelectedCount ?? 0,
    draftSelectedCount: value.draftSelectedCount ?? 0,
    revision: value.revision,
  }
}

/** Payload endpoint definitions for the small Collection lifecycle surface. */
export function collectionEndpoints(
  repositoryForRequest: RepositoryFactory = (request) => createCollectionRepository(request.payload),
): Endpoint[] {
  return [
    {
      method: 'get', path: '/admin/v1/collections',
      handler: guarded(async (request) => {
        const model = request.payload.db.collections['collections']
        if (!model) throw new Error('Missing collections model')
        const cursor = listCursor(request)
        const query: Record<string, unknown> = cursor ? {
          $or: [
            { title: { $gt: cursor.title } },
            { title: cursor.title, _id: { $gt: cursor.id } },
          ],
        } : {}
        const rows = await (model as {
          find(query: Record<string, unknown>): {
            sort(sort: Record<string, 1 | -1>): { limit(limit: number): { lean(): Promise<unknown[]> } }
          }
        }).find(query).sort({ title: 1, _id: 1 }).limit(LIST_PAGE_SIZE + 1).lean()
        const page = rows.slice(0, LIST_PAGE_SIZE)
        return Response.json({
          items: page.map(publicCollection),
          nextCursor: rows.length > LIST_PAGE_SIZE ? encodeListCursor(page[page.length - 1] as Record<string, unknown>) : null,
        })
      }),
    },
    {
      method: 'post', path: '/admin/v1/collections',
      handler: guarded(async (request, actor) => {
        const body = await jsonBody(request as unknown as Request)
        const collection = await repositoryForRequest(request).createCollection(
          metadataFrom(body, true) as Required<Pick<CollectionMetadataInput, 'slug' | 'title'>> & Pick<CollectionMetadataInput, 'description'>,
          commandContext(request.headers, actor),
        )
        return Response.json(collection, { status: 201 })
      }),
    },
    {
      method: 'get', path: '/admin/v1/collections/:id',
      handler: guarded(async (request) => Response.json(await repositoryForRequest(request).getCollection(routeId(request)))),
    },
    {
      method: 'patch', path: '/admin/v1/collections/:id',
      handler: guarded(async (request, actor) => {
        const body = await jsonBody(request as unknown as Request)
        const collection = await repositoryForRequest(request).patchCollectionMetadata(
          routeId(request), parseIfMatch(request.headers), metadataFrom(body), commandContext(request.headers, actor),
        )
        return Response.json(collection)
      }),
    },
    {
      method: 'delete', path: '/admin/v1/collections/:id',
      handler: guarded(async (request, actor) => {
        await repositoryForRequest(request).hardDeleteNeverPublished(
          routeId(request), parseIfMatch(request.headers), commandContext(request.headers, actor),
        )
        return new Response(null, { status: 204 })
      }),
    },
    {
      method: 'post', path: '/admin/v1/collections/:id/archive',
      handler: guarded(async (request, actor) => Response.json(await repositoryForRequest(request).archiveCollection(
        routeId(request), parseIfMatch(request.headers), commandContext(request.headers, actor),
      ))),
    },
    {
      method: 'post', path: '/admin/v1/collections/:id/restore',
      handler: guarded(async (request, actor) => Response.json(await repositoryForRequest(request).restoreCollection(
        routeId(request), parseIfMatch(request.headers), commandContext(request.headers, actor),
      ))),
    },
  ]
}