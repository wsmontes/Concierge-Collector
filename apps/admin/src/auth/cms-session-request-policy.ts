import { readEnv } from '../env'
import { AdminHttpError } from '../http/errors'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const SAFE_NO_ORIGIN_FETCH_SITES = new Set(['none', 'same-origin'])

/** Returns whether the request carries the host-only CMS session credential. */
export function hasCmsSessionCookie(headers: Headers): boolean {
  return (headers.get('cookie') || '')
    .split(';')
    .map((value) => value.trim())
    .some((value) => value.startsWith('cms_session='))
}

function isAdminOrigin(origin: string | null): boolean {
  if (!origin) return false

  try {
    return new URL(origin).origin === readEnv().publicServerUrl
  } catch {
    return false
  }
}

/**
 * Payload custom strategies receive headers, not a request method. An Origin is
 * therefore required whenever the browser supplies one and must be exactly the
 * configured Admin origin. A top-level browser navigation legitimately omits
 * Origin; in that narrow case `Sec-Fetch-Site: none` (user navigation) and
 * `same-origin` are safe. Same-site sibling and cross-site requests are denied.
 */
export function isTrustedCmsSessionRequest(headers: Headers): boolean {
  const origin = headers.get('origin')
  if (origin) return isAdminOrigin(origin)

  return SAFE_NO_ORIGIN_FETCH_SITES.has(headers.get('sec-fetch-site') || '')
}

/**
 * Cookie-authenticated writes have no safe no-Origin case. Bearer requests are
 * intentionally unaffected so API clients can move to that path independently.
 */
export function assertUnsafeCmsSessionOrigin(method: string, headers: Headers): void {
  if (SAFE_METHODS.has(method.toUpperCase()) || !hasCmsSessionCookie(headers)) return
  if (!isAdminOrigin(headers.get('origin'))) {
    throw new AdminHttpError(403, 'csrf_origin_invalid')
  }
}
