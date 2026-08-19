import { createHash } from 'node:crypto'

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/** Hashes the complete, normalized command payload. Never accept this hash from a client. */
export function collectionCommandHash(command: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(command)).digest('hex')
}

/**
 * Produces a bounded, opaque audit key. Scope is a Collection for mutations and
 * an actor for creates, which have no Collection id until the command succeeds.
 */
export function collectionCommandKey(scope: string, idempotencyKey: string): string {
  const digest = collectionCommandHash({ idempotencyKey, scope })
  return `collection-command:${digest}`
}
