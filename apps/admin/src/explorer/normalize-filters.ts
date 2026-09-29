import type { CurationFilters, NormalizedCurationFilters } from './types'

function trimmed(value: string | null | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

/** Canonical input shared by list/search, select-all and eventual manifests. */
export function normalizeCurationFilters(filters: CurationFilters): NormalizedCurationFilters {
  const q = trimmed(filters.q)?.toLowerCase()
  const city = trimmed(filters.city)
  const entityType = trimmed(filters.entity_type)
  const curatorId = trimmed(filters.curator_id)
  const status = [...new Set((filters.status ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean))].sort()

  return {
    ...(q ? { q } : {}),
    ...(status.length ? { status } : {}),
    ...(city ? { city } : {}),
    ...(entityType ? { entity_type: entityType } : {}),
    ...(curatorId ? { curator_id: curatorId } : {}),
  }
}

/** Stable browser-safe key. It identifies an intent; it is not an authorization token. */
export async function hashNormalizedFilters(filters: NormalizedCurationFilters): Promise<string> {
  const canonical = JSON.stringify(filters, Object.keys(filters).sort())
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
