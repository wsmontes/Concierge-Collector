import { getPayload } from 'payload'
import { authzClient, mirrorCmsUser } from './cms-strategy'
import { resolveCmsSession, revokeCmsSession } from './cms-session'
import type { CmsIdentity } from './fastapi-authz-client'

export class CmsAuthorizationError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: 'authentication_required' | 'authorization_revoked',
  ) {
    super(code)
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
    throw new CmsAuthorizationError(401, 'authentication_required')
  }
  if (!identity.authorized || identity.role !== 'admin') {
    await revokeCmsSession(payload, session.id)
    throw new CmsAuthorizationError(403, 'authorization_revoked')
  }

  await mirrorCmsUser(payload, identity)
  return identity
}
