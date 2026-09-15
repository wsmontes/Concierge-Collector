import type { Endpoint, PayloadRequest } from 'payload'
import type { Model } from 'mongoose'
import type { CmsIdentity } from '../../auth/fastapi-authz-client'
import type { ContentHealth } from '../../components/overview/ContentHealthView'
import { withAdmin, type AdminRequest } from '../../http/with-admin'
import { RecordsAdapter } from '../../records/client'

type DocumentModel = Model<Record<string, unknown>>

/**
 * The guarded request is both: `withAdmin` proves the CMS session and the live
 * actor arrives as the handler's second argument — the house convention every
 * endpoint factory follows.
 */
type AdminHealthRequest = AdminRequest & PayloadRequest

/**
 * The Catalog boundary rejects a member set larger than this with a 413, so the
 * endpoint never forwards one. When the ledger is bigger the request still
 * carries a bounded prefix and the counter that depends on the full set is
 * reported as unknown instead of being silently computed from a partial one.
 */
const MEMBERSHIP_ID_CAP = 10000

const DEGRADED_LEDGER_TOO_LARGE =
  `The CMS membership ledger tracks more than ${MEMBERSHIP_ID_CAP} Curations, so the boundary received a bounded set of member ids and "Without Collections" is unavailable.`

function modelFor(request: AdminHealthRequest, slug: string): DocumentModel {
  const model = request.payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

/**
 * Curations some Collection currently holds. Collections live in the CMS
 * database, so this comes from the CMS's own membership ledger — a row is
 * current while `removedInVersion` is null.
 */
async function memberCurationIds(request: AdminHealthRequest): Promise<string[]> {
  const ids = await modelFor(request, 'collection-memberships')
    .distinct('curationId', { removedInVersion: null }) as unknown[]
  return ids.map((id) => String(id)).filter((id) => id.length > 0).sort()
}

function guard(handler: (request: AdminHealthRequest, actor: CmsIdentity) => Promise<Response>) {
  const protectedHandler = withAdmin((request, actor) => handler(request as AdminHealthRequest, actor))
  return (request: PayloadRequest) => protectedHandler(request as unknown as Request)
}

/**
 * Browser BFF for the editorial dashboard (plan §37/§47): objective counters,
 * each one the target of a list query. The counters themselves are the Catalog
 * boundary's answer; this route adds only the CMS-side membership ledger.
 */
export function healthEndpoints(
  adapterForRequest: (request: AdminHealthRequest) => Pick<RecordsAdapter, 'contentHealth'> = () => new RecordsAdapter(),
): Endpoint[] {
  return [
    {
      method: 'get', path: '/admin/v1/records/content-health',
      handler: guard(async (request, actor) => {
        const memberIds = await memberCurationIds(request)
        const degraded = memberIds.length > MEMBERSHIP_ID_CAP ? DEGRADED_LEDGER_TOO_LARGE : null
        const counters = await adapterForRequest(request).contentHealth(
          memberIds.slice(0, MEMBERSHIP_ID_CAP),
          actor.user_id,
        )
        const body: ContentHealth = {
          total: counters.total,
          unlinked: counters.unlinked,
          synthetic_drafts: counters.synthetic_drafts,
          without_images: counters.without_images,
          without_transcript: counters.without_transcript,
          updated_today: counters.updated_today,
          without_collections: degraded ? null : counters.without_collections,
          collections_members_tracked: memberIds.length,
          degraded,
        }
        return Response.json(body)
      }),
    },
  ]
}
