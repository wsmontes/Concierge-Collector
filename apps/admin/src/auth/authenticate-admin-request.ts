import { randomUUID } from 'node:crypto'
import { FastApiAuthzError, type CmsIdentity } from './fastapi-authz-client'
import { authzClient } from './cms-strategy'
import { requireCurrentAdmin } from './require-current-admin'
import { assertUnsafeCmsSessionOrigin } from './cms-session-request-policy'
import { readEnv } from '../env'
import { requireFeature } from '../feature-flags'
import { AdminHttpError } from '../http/errors'

export interface AdminRequestAuthenticationInput {
  allowCollectorBearer?: boolean
  allowCollectorOperationRead?: boolean
  explicitCurationIds?: readonly string[]
}

interface Dependencies {
  collectorOrigins: readonly string[]
  publicServerUrl: string
  introspectCollectorBearer: (authorization: string, requestId: string) => Promise<CmsIdentity>
  requireCurrentAdmin: (headers: Headers) => Promise<CmsIdentity>
}

function requestId(headers: Headers): string {
  const supplied = headers.get('x-request-id')?.trim()
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID()
}

/**
 * Authenticates the two intentionally separate browser paths.
 *
 * A Collector origin can never fall back to a cookie: it must present a live
 * admin Bearer and be explicitly scoped to exactly one Curation. Admin-origin
 * requests keep the host-only CMS-session path and its CSRF policy.
 */
export async function authenticateAdminRequest(
  request: Request,
  input: AdminRequestAuthenticationInput = {},
  dependencies: Partial<Dependencies> = {},
): Promise<CmsIdentity> {
  const env = readEnv()
  const resolved: Dependencies = {
    collectorOrigins: env.collectorOrigins,
    publicServerUrl: env.publicServerUrl,
    introspectCollectorBearer: async (authorization, currentRequestId) => authzClient().introspectCollectorBearer(authorization, currentRequestId),
    requireCurrentAdmin,
    ...dependencies,
  }
  const origin = request.headers.get('origin')

  if (origin && resolved.collectorOrigins.includes(origin)) {
    // Collector read and mutation rollout can be stopped independently without
    // trusting a browser/UI flag. The origin is already an explicit allowlist.
    if (request.method.toUpperCase() === 'GET' || request.method.toUpperCase() === 'HEAD') {
      requireFeature('collector_association_read')
    } else {
      requireFeature('collector_draft_mutation')
    }

    const authorization = request.headers.get('authorization')
    const scopedToOneCuration = input.explicitCurationIds?.length === 1
    if (!input.allowCollectorBearer || (!scopedToOneCuration && !input.allowCollectorOperationRead) || !authorization?.startsWith('Bearer ')) {
      throw new AdminHttpError(403, 'authorization_denied')
    }
    try {
      return await resolved.introspectCollectorBearer(authorization, requestId(request.headers))
    } catch (error) {
      // FastAPI never supplies a trusted role to this layer; failure is a
      // denial, not an opportunity to try a CMS cookie.
      if (error instanceof FastApiAuthzError && error.status === 401) throw new AdminHttpError(401, 'authentication_required')
      if (error instanceof FastApiAuthzError && error.status === 503) throw new AdminHttpError(503, 'authorization_unavailable')
      throw new AdminHttpError(403, 'authorization_denied')
    }
  }

  if (origin && origin !== resolved.publicServerUrl) throw new AdminHttpError(403, 'authorization_denied')
  assertUnsafeCmsSessionOrigin(request.method, request.headers)
  return resolved.requireCurrentAdmin(request.headers)
}
