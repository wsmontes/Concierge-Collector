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

function noStore(response: Response): Response {
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
      return noStore(await handler(adminRequest, actor))
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
