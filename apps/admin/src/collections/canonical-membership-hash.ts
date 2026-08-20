import { createHash } from 'node:crypto'

const DOMAIN_SEPARATOR = 'concierge-collection-membership\0'

type CurationIdStream = Iterable<string> | AsyncIterable<string>

/**
 * Computes the membership digest without materializing the membership set.
 * Callers must provide canonical curation IDs ordered lexicographically by the
 * storage query. Equal neighbouring IDs are safely coalesced; any other order
 * violation is rejected instead of silently producing a different snapshot.
 */
export async function computeCanonicalMembershipHash(
  curationIds: CurationIdStream,
  schemaVersion: number,
): Promise<string> {
  const hash = createHash('sha256')
  hash.update(DOMAIN_SEPARATOR)
  hash.update(String(schemaVersion))
  hash.update('\0')

  let previousId: string | undefined

  for await (const curationId of curationIds) {
    if (typeof curationId !== 'string' || curationId.length === 0 || /[\0\n]/.test(curationId)) {
      throw new TypeError('Curation IDs must be non-empty canonical strings')
    }

    if (previousId !== undefined) {
      if (curationId === previousId) continue
      if (curationId < previousId) {
        throw new Error('Curation IDs must be strictly monotonic after adjacent deduplication')
      }
    }

    hash.update(curationId)
    hash.update('\n')
    previousId = curationId
  }

  return hash.digest('hex')
}
