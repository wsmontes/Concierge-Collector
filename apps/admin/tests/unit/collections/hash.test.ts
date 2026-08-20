import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { computeCanonicalMembershipHash } from '../../../src/collections/canonical-membership-hash'

function expectedHash(ids: string[], schemaVersion: number): string {
  const hash = createHash('sha256')
  hash.update('concierge-collection-membership\0')
  hash.update(String(schemaVersion))
  hash.update('\0')
  for (const id of ids) hash.update(`${id}\n`)
  return hash.digest('hex')
}

async function* stream(ids: string[]): AsyncGenerator<string> {
  for (const id of ids) yield id
}

describe('canonical membership hash', () => {
  test('hashes an ordered synchronous stream incrementally', async () => {
    await expect(computeCanonicalMembershipHash(['curation-a', 'curation-b'], 1))
      .resolves.toBe(expectedHash(['curation-a', 'curation-b'], 1))
  })

  test('accepts an ordered asynchronous stream and deduplicates only adjacent IDs', async () => {
    await expect(computeCanonicalMembershipHash(stream(['curation-a', 'curation-a', 'curation-b']), 1))
      .resolves.toBe(expectedHash(['curation-a', 'curation-b'], 1))
  })

  test('does not coalesce a non-adjacent duplicate', async () => {
    await expect(computeCanonicalMembershipHash(['curation-a', 'curation-b', 'curation-a'], 1))
      .rejects.toThrow(/strictly monotonic/i)
  })

  test('rejects IDs that would make delimiter-based encoding ambiguous', async () => {
    await expect(computeCanonicalMembershipHash(['curation-a\ncuration-b'], 1))
      .rejects.toThrow(/canonical strings/i)
    await expect(computeCanonicalMembershipHash(['curation-a\0curation-b'], 1))
      .rejects.toThrow(/canonical strings/i)
  })

  test('rejects IDs outside canonical monotonic order', async () => {
    await expect(computeCanonicalMembershipHash(['curation-b', 'curation-a'], 1))
      .rejects.toThrow(/strictly monotonic/i)
  })

  test('includes schema version in the digest', async () => {
    const ids = ['curation-a']

    await expect(computeCanonicalMembershipHash(ids, 1))
      .resolves.not.toBe(await computeCanonicalMembershipHash(ids, 2))
  })
})
