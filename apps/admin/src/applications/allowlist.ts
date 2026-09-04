import type { ClientSession, Model } from 'mongoose'
import { AdminHttpError } from '../http/errors'

type DocumentModel = Model<Record<string, unknown>>

export function grantableCollectionFilter(ids: string[]): Record<string, unknown> {
  return {
    _id: { $in: [...new Set(ids)] },
    lifecycle: 'published',
    currentPublishedVersion: { $type: 'number' },
  }
}

export function storedAllowedCollectionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((entry) => String(
    typeof entry === 'object' && entry !== null && 'collectionId' in entry
      ? (entry as { collectionId?: unknown }).collectionId
      : entry,
  )))]
}

export function newlyAddedCollectionIds(current: string[], desired: string[]): string[] {
  const currentIds = new Set(current)
  return [...new Set(desired)].filter((id) => !currentIds.has(id))
}

export async function assertGrantableCollectionIds(
  collections: DocumentModel,
  ids: string[],
  session: ClientSession,
): Promise<void> {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return

  const rows = await collections
    .find(grantableCollectionFilter(uniqueIds))
    .select({ _id: 1 })
    .session(session)
    .lean()

  const found = new Set(rows.map((row) => String(row._id)))
  if (found.size !== uniqueIds.length || uniqueIds.some((id) => !found.has(id))) {
    throw new AdminHttpError(400, 'collection_not_grantable')
  }
}
