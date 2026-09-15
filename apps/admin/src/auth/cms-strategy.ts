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

/** Quanto tempo um espelho sem mudanças continua válido sem nova escrita. */
const MIRROR_REFRESH_MS = 60_000

export async function mirrorCmsUser(payload: Payload, identity: CmsIdentity): Promise<CmsUser> {
  const existing = await payload.find({
    collection: 'cms-users',
    where: { fastapiUserId: { equals: identity.user_id } },
    limit: 1,
    overrideAccess: true,
  })
  const current = existing.docs[0]
  const fields = {
    fastapiUserId: identity.user_id,
    email: identity.email,
    name: identity.name,
    picture: identity.picture,
    role: identity.role,
    authorized: identity.authorized,
    authzRevision: identity.authz_revision,
  }
  const fresh = current?.lastIntrospectedAt
    ? Date.now() - Date.parse(String(current.lastIntrospectedAt)) < MIRROR_REFRESH_MS
    : false
  const unchanged = Boolean(current)
    && String(current.fastapiUserId) === fields.fastapiUserId
    && String(current.email) === fields.email
    && String(current.name) === fields.name
    && (current.picture ?? null) === fields.picture
    && String(current.role) === fields.role
    && current.authorized === fields.authorized
    && String(current.authzRevision) === fields.authzRevision
  // O carimbo `lastIntrospectedAt` mudava a cada request, então TODO request
  // autenticado gravava esta linha — e requisições concorrentes da mesma sessão
  // colidiam na transação do Payload ("Write conflict during plan execution and
  // yielding is disabled", medido em produção), derrubando leituras com 503. Só
  // escreve quando a identidade mudou de fato ou quando o carimbo venceu.
  if (current && unchanged && fresh) return current

  const data = { ...fields, lastIntrospectedAt: new Date().toISOString() }
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

    let identity: CmsIdentity
    try {
      identity = await authzClient().introspectSubject(session.subject)
    } catch (error) {
      // An unavailable authorization authority must never leave a CMS session trusted.
      console.warn('[cms-session] cms authorization introspection failed', error)
      return { user: null }
    }
    if (!identity.authorized || identity.role !== 'admin') {
      try {
        await revokeCmsSession(payload, session.id)
      } catch (error) {
        console.warn('[cms-session] cms session revocation failed', error)
      }
      return { user: null }
    }
    try {
      const user = await mirrorCmsUser(payload, identity)
      return { user: { ...user, collection: 'cms-users' } }
    } catch (error) {
      // Uma colisão de escrita no espelho não pode deslogar quem o FastAPI
      // acabou de autorizar (era o sintoma: o Admin devolvia o curador para o
      // login no meio da sessão). Se a linha já existe, ela serve — um papel
      // velho no pior caso NEGA, que é fail-closed; sem linha nenhuma (primeiro
      // acesso) a sessão continua recusada.
      console.warn('[cms-session] cms-users mirror failed', error)
      const mirrored = await payload
        .find({
          collection: 'cms-users',
          where: { fastapiUserId: { equals: identity.user_id } },
          limit: 1,
          overrideAccess: true,
        })
        .catch(() => null)
      const existing = mirrored?.docs[0]
      return existing ? { user: { ...existing, collection: 'cms-users' } } : { user: null }
    }
  },
}
