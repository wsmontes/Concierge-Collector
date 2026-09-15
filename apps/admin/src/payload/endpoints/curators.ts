import type { Endpoint, PayloadRequest } from 'payload'
import type { CmsIdentity } from '../../auth/fastapi-authz-client'
import { AdminHttpError } from '../../http/errors'
import { RecordsAdapter } from '../../records/client'
import { withAdmin, type AdminRequest } from '../../http/with-admin'
import { isRecord } from '../../content/value-guards'

/**
 * One curator of the directory the Curation curator picker offers. Same three
 * values the boundary serves (`app/api/catalog_curators.py`): the identity the
 * picker writes into `curator_id` and the two fields it renders.
 */
export interface CuratorRow {
  curator_id: string
  name: string | null
  email: string | null
}

/** The guarded request carries both the Payload route and the proved CMS session. */
type AdminCuratorRequest = AdminRequest & PayloadRequest

/**
 * Optional query value, resolved like the sibling record routes: absent,
 * whitespace-only and over-long all end up the same way here.
 */
function optionalParam(request: AdminCuratorRequest, name: string, max: number): string | null {
  const raw = new URL((request as unknown as Request).url).searchParams.get(name)?.trim()
  if (raw === undefined || raw.length === 0) return null
  if (raw.length > max) throw new AdminHttpError(400, 'invalid_request')
  return raw
}

/**
 * Keeps the rows a picker can act on: a row without an identity cannot be
 * written into a Curation, and inventing one would assign a curator that does
 * not exist. Everything else the boundary may send is dropped, not guessed.
 */
function toCuratorRows(value: unknown): CuratorRow[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  const rows: CuratorRow[] = []
  for (const entry of value.items) {
    if (!isRecord(entry)) continue
    const curatorId = entry.curator_id
    if (typeof curatorId !== 'string' || curatorId.length === 0) continue
    rows.push({
      curator_id: curatorId,
      name: typeof entry.name === 'string' ? entry.name : null,
      email: typeof entry.email === 'string' ? entry.email : null,
    })
  }
  return rows
}

/**
 * The curator directory read, server-side only. It goes through the same
 * `RecordsAdapter` every other record surface uses, so the boundary credential,
 * the actor header and the error mapping stay in one place; the browser never
 * learns the service key.
 */
async function searchCurators(query: string | null, actorId: string): Promise<CuratorRow[]> {
  const rows = await new RecordsAdapter().curatorDirectory(query, actorId)
  return toCuratorRows(rows)
}

function guard(handler: (request: AdminCuratorRequest, actor: CmsIdentity) => Promise<Response>) {
  const protectedHandler = withAdmin((request, actor) => handler(request as AdminCuratorRequest, actor))
  return (request: PayloadRequest) => protectedHandler(request as unknown as Request)
}

/**
 * Browser BFF for the curator directory. There is exactly one route because
 * there is exactly one question: which curators match what the editor typed.
 * A failure keeps the boundary's meaning — a 403 there (the actor may not read
 * the directory, or may not reassign this Curation) comes back as a 403 here,
 * never as an empty list.
 */
export function curatorEndpoints(
  search: (input: { query: string | null; actorId: string }) => Promise<CuratorRow[]> = ({ query, actorId }) =>
    searchCurators(query, actorId),
): Endpoint[] {
  return [
    {
      method: 'get', path: '/admin/v1/records/curators',
      handler: guard(async (adminRequest, actor) => {
        const query = optionalParam(adminRequest, 'q', 200)
        return Response.json({ items: await search({ query, actorId: actor.user_id }) })
      }),
    },
  ]
}
