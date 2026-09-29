import type { AuthStrategy, AuthStrategyFunctionArgs, Payload } from 'payload'
import type { CmsIdentity } from './fastapi-authz-client'
import { FastApiAuthzClient } from './fastapi-authz-client'
import { revokeCmsSession, resolveCmsSession } from './cms-session'
import { isTrustedCmsSessionRequest } from './cms-session-request-policy'
import { readEnv } from '../env'
import type { CmsUser } from '../payload/generated/payload-types'

export function authzClient(): FastApiAuthzClient {
  const env = readEnv()
  return new FastApiAuthzClient(env.fastApiBaseUrl, env.cmsServiceKey)
}

export async function mirrorCmsUser(payload: Payload, identity: CmsIdentity): Promise<CmsUser> {
  const existing = await payload.find({
    collection: 'cms-users',
    where: { fastapiUserId: { equals: identity.user_id } },
    limit: 1,
    overrideAccess: true,
  })
  const data = {
    fastapiUserId: identity.user_id,
    email: identity.email,
    name: identity.name,
    picture: identity.picture,
    role: identity.role,
    authorized: identity.authorized,
    authzRevision: identity.authz_revision,
    lastIntrospectedAt: new Date().toISOString(),
  }
  const current = existing.docs[0]
  if (current) {
    return payload.update({
      collection: 'cms-users',
      id: current.id,
      data,
      overrideAccess: true,
    })
  }
  return payload.create({ collection: 'cms-users', data, overrideAccess: true })
}

/** Payload's official custom auth-strategy contract for the CMS cookie. */
export const cmsSessionStrategy: AuthStrategy = {
  name: 'cms-session',
  authenticate: async ({ payload, headers }: AuthStrategyFunctionArgs) => {
    const session = await resolveCmsSession(payload, headers.get('cookie') || '')
    if (!session) return { user: null }
    if (!isTrustedCmsSessionRequest(headers)) return { user: null }

    try {
      const identity = await authzClient().introspectSubject(session.subject)
      if (!identity.authorized || identity.role !== 'admin') {
        await revokeCmsSession(payload, session.id)
        return { user: null }
      }
      const user = await mirrorCmsUser(payload, identity)
      return { user: { ...user, collection: 'cms-users' } }
    } catch {
      // An unavailable authorization authority must never leave a CMS session trusted.
      return { user: null }
    }
  },
}
