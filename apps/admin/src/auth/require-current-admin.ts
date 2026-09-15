import { getPayload } from 'payload'
import type { Payload } from 'payload'
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

async function currentPayload(): Promise<Payload> {
  const [{ default: config }] = await Promise.all([import('../../payload.config')])
  return getPayload({ config })
}

/**
 * Colaboradores injetáveis, igual ao `withAdmin`: a tolerância a falha do
 * espelho (abaixo) é o que impede uma escrita perdida de virar 503 numa leitura,
 * então ela precisa de teste sem subir o Payload.
 */
export interface CurrentAdminDependencies {
  loadPayload: () => Promise<Payload>
  resolveSession: typeof resolveCmsSession
  introspect: (subject: string) => Promise<CmsIdentity>
  mirrorUser: typeof mirrorCmsUser
  revokeSession: typeof revokeCmsSession
}

const dependencies: CurrentAdminDependencies = {
  loadPayload: currentPayload,
  resolveSession: resolveCmsSession,
  introspect: (subject) => authzClient().introspectSubject(subject),
  mirrorUser: mirrorCmsUser,
  revokeSession: revokeCmsSession,
}

/** Resolves the host-only cookie and checks live FastAPI authorization on every call. */
export async function requireCurrentAdmin(
  headers: Headers,
  overrides: Partial<CurrentAdminDependencies> = {},
): Promise<CmsIdentity> {
  const deps = { ...dependencies, ...overrides }
  const payload = await deps.loadPayload()
  const session = await deps.resolveSession(payload, headers.get('cookie') || '')
  if (!session) throw new CmsAuthorizationError(401, 'authentication_required')

  let identity: CmsIdentity
  try {
    identity = await deps.introspect(session.subject)
  } catch (error) {
    console.warn('[withAdmin] cms authorization introspection failed', error)
    throw new AdminHttpError(503, 'authorization_unavailable')
  }
  if (!identity.authorized || identity.role !== 'admin') {
    // The FastAPI decision is authoritative even if the local revocation write
    // is temporarily unavailable. Never turn a confirmed downgrade into 503.
    try {
      await deps.revokeSession(payload, session.id)
    } catch {
      // A later request will attempt the local cleanup again and still recheck
      // FastAPI before granting access.
    }
    throw new CmsAuthorizationError(403, 'authorization_revoked')
  }

  // O espelho em `cms-users` é conveniência do CMS (nome, papel e avatar na UI);
  // quem autoriza é a resposta do FastAPI acima. Uma escrita que perde a corrida
  // — requisições concorrentes da mesma sessão gravam a mesma linha — não pode
  // transformar uma leitura autenticada em 503, que foi o que aconteceu em
  // produção (`Write conflict during plan execution and yielding is disabled`).
  try {
    await deps.mirrorUser(payload, identity)
  } catch (error) {
    console.warn('[withAdmin] cms-users mirror failed', error)
  }
  return identity
}
