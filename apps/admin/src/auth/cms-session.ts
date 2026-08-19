import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Payload } from 'payload'

const LOGIN_STATE_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 8 * 60 * 60 * 1000

export interface CmsLoginState {
  returnTo: string
}

export interface CmsSessionRecord {
  id: string
  subject: string
  user: string
  expiresAt: string
  revokedAt?: string | null
}

export interface LoginStateRepository {
  consumeStateHash(stateHash: string): Promise<CmsLoginState | null>
}

export interface SessionToken {
  hash: string
  raw: string
}

const hashValue = (value: string): string => createHash('sha256').update(value).digest('hex')

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function createSessionToken(): SessionToken {
  const raw = randomBytes(32).toString('base64url')

  return { raw, hash: hashValue(raw) }
}

export function isSafeAdminReturnTo(value: string | null): value is string {
  return typeof value === 'string' && /^\/admin(?:\/|$)/.test(value)
}

export async function consumeLoginState(
  repository: LoginStateRepository,
  cookieValue: string | undefined,
  queryState: string | null,
): Promise<CmsLoginState> {
  if (!cookieValue || !queryState || !constantTimeEqual(cookieValue, queryState)) {
    throw new Error('Invalid login state')
  }

  const state = await repository.consumeStateHash(hashValue(queryState))
  if (!state) throw new Error('Invalid login state')

  return state
}

export async function createLoginState(payload: Payload, returnTo: string): Promise<string> {
  const token = createSessionToken()
  await payload.create({
    collection: 'cms-login-states',
    data: {
      stateHash: token.hash,
      returnTo,
      expiresAt: new Date(Date.now() + LOGIN_STATE_TTL_MS).toISOString(),
    },
    overrideAccess: true,
  })
  return token.raw
}

export async function consumePersistedLoginState(
  payload: Payload,
  cookieValue: string | undefined,
  queryState: string | null,
): Promise<CmsLoginState> {
  return consumeLoginState(
    {
      consumeStateHash: async (stateHash) => {
        // Payload's high-level bulk update first reads all matching documents, so it
        // cannot safely consume a one-time credential under concurrent callbacks.
        // In Payload 3.86 the Mongo adapter's `db.updateOne` delegates to a single
        // Mongoose `findOneAndUpdate`, which makes this predicate-and-write a CAS.
        const consumed = await payload.db.updateOne({
          collection: 'cms-login-states',
          data: { consumedAt: new Date().toISOString() },
          where: {
            and: [
              { stateHash: { equals: stateHash } },
              { consumedAt: { exists: false } },
              { expiresAt: { greater_than: new Date().toISOString() } },
            ],
          },
        }) as unknown as { returnTo?: unknown } | null
        if (!consumed || typeof consumed.returnTo !== 'string') return null
        return { returnTo: consumed.returnTo }
      },
    },
    cookieValue,
    queryState,
  )
}

export async function createCmsSession(
  payload: Payload,
  input: { subject: string; user: string },
): Promise<string> {
  const token = createSessionToken()
  await payload.create({
    collection: 'cms-sessions',
    data: {
      sessionHash: token.hash,
      subject: input.subject,
      user: input.user,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    },
    overrideAccess: true,
  })
  return token.raw
}

export async function resolveCmsSession(payload: Payload, cookieHeader: string): Promise<CmsSessionRecord | null> {
  const cookieValue = cookieHeader
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith('cms_session='))
    ?.slice('cms_session='.length)
  if (!cookieValue) return null

  const result = await payload.find({
    collection: 'cms-sessions',
    where: {
      and: [
        { sessionHash: { equals: hashValue(cookieValue) } },
        { revokedAt: { exists: false } },
        { expiresAt: { greater_than: new Date().toISOString() } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const session = result.docs[0]
  if (!session || typeof session.subject !== 'string' || typeof session.user !== 'string') return null

  return {
    id: String(session.id),
    subject: session.subject,
    user: session.user,
    expiresAt: String(session.expiresAt),
    revokedAt: typeof session.revokedAt === 'string' ? session.revokedAt : null,
  }
}

export async function revokeCmsSession(payload: Payload, sessionId: string): Promise<void> {
  await payload.update({
    collection: 'cms-sessions',
    id: sessionId,
    data: { revokedAt: new Date().toISOString() },
    overrideAccess: true,
  })
}
