import type { CmsIdentity } from '../auth/fastapi-authz-client'
import { requireCurrentAdmin } from '../auth/require-current-admin'
import { assertUnsafeCmsSessionOrigin } from '../auth/cms-session-request-policy'
import { adminErrorResponse } from './errors'

export type AdminRequest = Request & { actor: CmsIdentity }

export type AdminHandler = (request: AdminRequest, actor: CmsIdentity) => Response | Promise<Response>

interface WithAdminDependencies {
  requireCurrentAdmin: (headers: Headers) => Promise<CmsIdentity>
  assertUnsafeCmsSessionOrigin: (method: string, headers: Headers) => void
}

/**
 * The only entry point for future `/api/admin/v1` handlers.
 *
 * It revalidates the CMS session against FastAPI on each request and overwrites
 * the request actor with that live identity. Request input never supplies actor.
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
      return await handler(adminRequest, actor)
    } catch (error) {
      return adminErrorResponse(error)
    }
  }
}
