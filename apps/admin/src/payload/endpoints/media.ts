import type { EntityImagesResponse } from '@concierge/fastapi-client'
import type { Endpoint, PayloadRequest } from 'payload'
import { readEnv } from '../../env'
import { AdminHttpError } from '../../http/errors'
import { withAdmin, type AdminRequest } from '../../http/with-admin'
import { RecordsAdapter } from '../../records/client'

/**
 * Media BFF for the Entity thumbnail.
 *
 * The Entity's image has no producer inside the CMS: the domain boundary
 * resolves it from the Entity's own website/place_id, downloads it under the
 * SSRF guard and reencodes it as JPEG. Two things the browser needs are missing
 * there — the credential it does not hold (the CMS service key) and a body it
 * can put in an `<img>` — so this file is the only bridge, and the only place
 * on the Admin that speaks to the two media routes.
 *
 * The gallery read goes through `RecordsAdapter`, the house client for every
 * JSON call to the boundary. The byte read keeps a direct `fetch` beyond it:
 * that route streams bytes, the shared client is typed for JSON by
 * construction, and buffering a JPEG per thumbnail is exactly what this proxy
 * exists to avoid.
 */

/**
 * The rank ceiling the boundary publishes (ranks 0..7, the collector's own
 * gallery bound). The BFF refuses anything outside it before a byte moves.
 */
const ENTITY_IMAGE_MAX_RANK = 7

type MediaRequest = AdminRequest & PayloadRequest

/** Domain ids are opaque (`rest_…`): no ObjectId shape to enforce here. */
function entityId(request: MediaRequest): string {
  const id = request.routeParams?.id
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) throw new AdminHttpError(404, 'not_found')
  return id
}

/** The rank the browser asked for; absent means the hero, exactly like the boundary. */
function rankParam(request: MediaRequest): number {
  const raw = new URL((request as unknown as Request).url).searchParams.get('rank')?.trim()
  if (raw === undefined || raw.length === 0) return 0
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > ENTITY_IMAGE_MAX_RANK) {
    throw new AdminHttpError(400, 'invalid_request')
  }
  return value
}

/** Boundary failure mapped onto the Admin error contract the browser already knows. */
function boundaryError(status: number): AdminHttpError {
  switch (status) {
    case 400:
    case 422:
      return new AdminHttpError(400, 'invalid_request')
    case 401:
    case 403:
      return new AdminHttpError(403, 'authorization_revoked')
    case 404:
      return new AdminHttpError(404, 'not_found')
    default:
      return new AdminHttpError(503, 'service_unavailable')
  }
}

export interface MediaAdapter {
  images(entityIdValue: string, actorId: string): Promise<EntityImagesResponse>
  image(entityIdValue: string, rank: number, actorId: string): Promise<Response>
}

/**
 * The Entity image bytes, read server-to-server with the service key.
 *
 * The upstream `Response` is returned untouched so its body stays a stream:
 * buffering it here would hold a whole JPEG in the Admin process's memory for
 * every thumbnail the page renders.
 */
export class FastApiEntityImageBytes implements Pick<MediaAdapter, 'image'> {
  private readonly env = readEnv()

  async image(entityIdValue: string, rank: number, actorId: string): Promise<Response> {
    const query = rank === 0 ? '' : `?rank=${rank}`
    const path = `/api/v3/catalog/entities/${encodeURIComponent(entityIdValue)}/image${query}`

    let response: Response
    try {
      response = await fetch(`${this.env.fastApiBaseUrl}${path}`, {
        cache: 'no-store',
        headers: {
          'X-CMS-Actor-Id': actorId,
          'X-CMS-Service-Key': this.env.cmsServiceKey,
        },
      })
    } catch {
      throw new AdminHttpError(503, 'service_unavailable')
    }
    if (!response.ok) throw boundaryError(response.status)
    return response
  }
}

/**
 * What the media routes need from the boundary, per request: the shared client
 * for the JSON gallery, the streaming proxy for the bytes. Injected so a test
 * exercises the routes without standing up either.
 */
export function mediaAdapter(): MediaAdapter {
  const records = new RecordsAdapter()
  const bytes = new FastApiEntityImageBytes()
  return {
    images: (entityIdValue, actorId) => records.entityImages(entityIdValue, actorId),
    image: (entityIdValue, rank, actorId) => bytes.image(entityIdValue, rank, actorId),
  }
}

function guard(handler: (request: MediaRequest, actorId: string) => Promise<Response>) {
  const protectedHandler = withAdmin((request, actor) => handler(request as MediaRequest, actor.user_id))
  return (request: PayloadRequest) => protectedHandler(request as unknown as Request)
}

/**
 * The two media routes of the Entity record surface. Both are reads: nothing
 * here writes, and the actor is always the one `withAdmin` proved.
 *
 * The adapter is built per request, exactly like `recordEndpoints`: the CMS
 * service credential is read at call time instead of frozen at boot.
 */
export function mediaEndpoints(
  adapterForRequest: (request: MediaRequest) => MediaAdapter = () => mediaAdapter(),
): Endpoint[] {
  return [
    {
      method: 'get', path: '/admin/v1/records/entities/:id/images',
      handler: guard(async (mediaRequest, actorId) => {
        const id = entityId(mediaRequest)
        const gallery = await adapterForRequest(mediaRequest).images(id, actorId)
        return Response.json({
          // The URL the browser can actually fetch is this BFF's, never the
          // boundary's: the browser holds a CMS session cookie, not the key.
          items: gallery.items.map((item) => ({
            ...item,
            url: `/api/admin/v1/records/entities/${encodeURIComponent(id)}/image?rank=${item.rank}`,
          })),
        })
      }),
    },
    {
      /**
       * Byte proxy. The upstream body is returned as it arrived — streamed, not
       * buffered — so a thumbnail costs the Admin no memory of its own, the
       * service key never crosses to the browser, and `withAdmin` keeps the
       * session-gated response out of any shared cache.
       */
      method: 'get', path: '/admin/v1/records/entities/:id/image',
      handler: guard(async (mediaRequest, actorId) => {
        const id = entityId(mediaRequest)
        return adapterForRequest(mediaRequest).image(id, rankParam(mediaRequest), actorId)
      }),
    },
  ]
}
