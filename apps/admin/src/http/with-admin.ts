import type { CmsIdentity } from '../auth/fastapi-authz-client'
import { requireCurrentAdmin } from '../auth/require-current-admin'
import { assertUnsafeCmsSessionOrigin } from '../auth/cms-session-request-policy'
import { AdminHttpError, adminErrorResponse } from './errors'

export type AdminRequest = Request & { actor: CmsIdentity }

export type AdminHandler = (request: AdminRequest, actor: CmsIdentity) => Response | Promise<Response>

interface WithAdminDependencies {
  requireCurrentAdmin: (headers: Headers) => Promise<CmsIdentity>
  assertUnsafeCmsSessionOrigin: (method: string, headers: Headers) => void
}

/**
 * True only for a policy that is `private` AND carries nothing aimed at shared
 * caches: `s-maxage` exists only for shared caches, and `public` contradicts
 * `private`. A contradictory value is malformed — it must not ride the
 * exemption into a proxy on the strength of the word "private".
 */
function isPrivateOnly(value: string): boolean {
  if (!/(^|[\s,])private([\s,]|$)/.test(value)) return false
  return !/(^|[\s,])(public|s-maxage)([\s,=]|$)/.test(value)
}

/**
 * Authenticated admin responses are never SHARABLE: a proxy must not hold them.
 * `private` is the line — a value without it (or any failure) is overwritten.
 *
 * A handler MAY declare its own freshness, but only inside `private`: the media
 * byte proxy forwards FastAPI's `private, max-age=…` so a thumbnail can be
 * re-used by the browser. Forcing `no-store` there was measured to re-download
 * every image on every visit — and each of those re-runs the upstream
 * fetch-and-reencode pipeline the response exists to avoid.
 */
function noStore(response: Response, allowPrivateHandlerPolicy = false): Response {
  if (allowPrivateHandlerPolicy) {
    const declared = response.headers.get('Cache-Control')
    if (declared && isPrivateOnly(declared)) return response
  }
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

/**
 * The only entry point for future `/api/admin/v1` handlers.
 *
 * It revalidates the CMS session against FastAPI on each request, overwrites
 * the request actor with that live identity and prevents authenticated admin
 * responses (including failures) from being stored by browsers or proxies.
 * Request input never supplies actor.
 */
export function withAdmin(
  handler: AdminHandler,
  dependencies: Partial<WithAdminDependencies> = {},
): (request: Request) => Promise<Response> {
  const resolvedDependencies: WithAdminDependencies = {
    requireCurrentAdmin,
    assertUnsafeCmsSessionOrigin,
    ...dependencies,
  }

  return async (request: Request): Promise<Response> => {
    try {
      resolvedDependencies.assertUnsafeCmsSessionOrigin(request.method, request.headers)
      const actor = await resolvedDependencies.requireCurrentAdmin(request.headers)
      const adminRequest = Object.assign(request, { actor }) as AdminRequest
      return noStore(await handler(adminRequest, actor), true)
    } catch (error) {
      // A resposta nunca carrega detalhe interno (é o contrato de
      // `adminErrorResponse`), então este log é o ÚNICO rastro que uma falha
      // inesperada deixa: sem ele, um 503 deste wrapper é indistinguível de uma
      // fronteira fora do ar e o incidente fica indiagnosticável pelos logs do
      // serviço. Só método, URL sem query e o erro — nunca headers ou cookie.
      const target = `${request.method} ${request.url.split('?')[0]}`
      if (error instanceof AdminHttpError) {
        if (error.status >= 500) console.warn(`[withAdmin] ${target} → ${error.status} ${error.code}`)
      } else {
        console.error(`[withAdmin] ${target} threw`, error)
      }
      return noStore(adminErrorResponse(error))
    }
  }
}
