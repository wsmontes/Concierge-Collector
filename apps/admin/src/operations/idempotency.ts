import { collectionCommandHash } from '../collections/idempotency'
import { AdminHttpError } from '../http/errors'
import type { DraftOperationAction } from './types'

/** Deduplicate only repeated IDs, preserving the submitted selection order. */
export function normalizeExplicitCurationIds(curationIds: string[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const curationId of curationIds) {
    if (typeof curationId !== 'string' || !curationId.trim()) throw new AdminHttpError(400, 'invalid_request')
    const normalized = curationId.trim()
    if (!seen.has(normalized)) {
      seen.add(normalized)
      ids.push(normalized)
    }
  }
  if (ids.length === 0 || ids.length > 500) throw new AdminHttpError(400, 'invalid_request')
  return ids
}

export function draftOperationRequestHash(input: {
  collectionId: string
  action: DraftOperationAction
  baseDraftRevision: number
  curationIds: string[]
}): string {
  return collectionCommandHash({
    action: input.action,
    baseDraftRevision: input.baseDraftRevision,
    collectionId: input.collectionId,
    curationIds: normalizeExplicitCurationIds(input.curationIds),
    mode: 'explicit',
  })
}
