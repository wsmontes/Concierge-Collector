import { randomUUID } from 'node:crypto'

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/

/** Return a safe correlation id and materialize it into the supplied headers. */
export function ensureRequestId(headers: Headers): string {
  const supplied = headers.get('x-request-id')?.trim()
  const requestId = supplied && REQUEST_ID_RE.test(supplied) ? supplied : randomUUID()
  headers.set('x-request-id', requestId)
  return requestId
}

/** Read a request id that has already passed through ensureRequestId. */
export function requestIdOf(headers: Headers): string | null {
  const value = headers.get('x-request-id')?.trim()
  return value && REQUEST_ID_RE.test(value) ? value : null
}
