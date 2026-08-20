import type { Payload } from 'payload'
import { authzClient, mirrorCmsUser } from './cms-strategy'
import { consumePersistedLoginState, createCmsSession } from './cms-session'
import type { CmsIdentity } from './fastapi-authz-client'

type HandoffInput = {
  code: string
  cookieValue?: string
  state: string
  targetOrigin: string
}

type HandoffDependencies = {
  consumeLoginState: () => Promise<{ returnTo: string } | null>
  createSession: (input: { subject: string; user: string }) => Promise<string>
  exchange: (input: { code: string; state: string; targetOrigin: string }) => Promise<CmsIdentity>
  mirrorUser: (identity: CmsIdentity) => Promise<{ id: string | number }>
}

export async function completeCmsHandoff(
  payload: Payload,
  input: HandoffInput,
  dependencies?: HandoffDependencies,
): Promise<{ returnTo: string; session: string }> {
  const deps = dependencies ?? {
    consumeLoginState: () => consumePersistedLoginState(payload, input.cookieValue, input.state),
    createSession: (session: { subject: string; user: string }) => createCmsSession(payload, session),
    exchange: (exchange: { code: string; state: string; targetOrigin: string }) => authzClient().exchangeCmsCode(exchange),
    mirrorUser: (identity: CmsIdentity) => mirrorCmsUser(payload, identity),
  }
  const loginState = await deps.consumeLoginState()
  if (!loginState) throw new Error('Invalid CMS login state')

  const identity = await deps.exchange({
    code: input.code,
    state: input.state,
    targetOrigin: input.targetOrigin,
  })
  if (!identity.authorized || identity.role !== 'admin') throw new Error('CMS admin access is required')

  const user = await deps.mirrorUser(identity)
  const session = await deps.createSession({ subject: identity.email, user: String(user.id) })
  return { returnTo: loginState.returnTo, session }
}
