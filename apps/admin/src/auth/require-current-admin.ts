import { getPayload } from 'payload'
import { authzClient, mirrorCmsUser } from './cms-strategy'
import { resolveCmsSession, revokeCmsSession } from './cms-session'
import type { CmsIdentity } from './fastapi-authz-client'
import { AdminHttpError } from '../http/errors'

export class CmsAuthorizationError extends AdminHttpError {
  constructor(
    readonly status: 401 | 403,
    readonly code: 'authentication_required' | 'authorization_revoked',
  ) {
    super(status, code)
  }
}

async function currentPayload() {
  const [{ default: config }] = await Promise.all([import('../../payload.config')])
  return getPayload({ config })
}

/** Resolves the host-only cookie and checks live FastAPI authorization on every call. */
export async function requireCurrentAdmin(headers: Headers): Promise<CmsIdentity> {
  const payload = await currentPayload()
  const session = await resolveCmsSession(payload, headers.get('cookie') || '')
  if (!session) throw new CmsAuthorizationError(401, 'authentication_required')

  let identity: CmsIdentity
  try {
    identity = await authzClient().introspectSubject(session.subject)
  } catch {
    throw new AdminHttpError(503, 'authorization_unavailable')
  }
  if (!identity.authorized || identity.role !== 'admin') {
    // The FastAPI decision is authoritative even if the local revocation write
    // is temporarily unavailable. Never turn a confirmed downgrade into 503.
    try {
      await revokeCmsSession(payload, session.id)
    } catch {
      // A later request will attempt the local cleanup again and still recheck
      // FastAPI before granting access.
    }
    throw new CmsAuthorizationError(403, 'authorization_revoked')
  }

  await mirrorCmsUser(payload, identity)
  return identity
}
