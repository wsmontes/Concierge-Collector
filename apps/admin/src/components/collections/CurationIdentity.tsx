import type { AdminCurationRow } from '../../explorer/types'

/**
 * The editorial identity of one Curation inside a Collection (§24/§25).
 *
 * Every part comes from the stored catalog row. A value the row does not carry
 * stays missing — no placeholder, no inferred name — and a member whose row the
 * catalog no longer holds degrades to its id plus an explicit note instead of a
 * blank cell.
 */
export interface CurationIdentityParts {
  name: string | null
  curator: string | null
  place: string | null
  concepts: string[]
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function identityParts(summary: AdminCurationRow | null): CurationIdentityParts {
  if (!summary) return { name: null, curator: null, place: null, concepts: [] }
  const place = [clean(summary.entity_type), clean(summary.city)].filter((part): part is string => part !== null)
  return {
    name: clean(summary.restaurant_name),
    curator: clean(summary.curator_name) ?? clean(summary.curator_id),
    place: place.length > 0 ? place.join(' · ') : null,
    concepts: (summary.concepts ?? []).filter((concept): concept is string => clean(concept) !== null),
  }
}

export function CurationIdentity({ curationId, summary }: { curationId: string; summary: AdminCurationRow | null }) {
  const identity = identityParts(summary)
  return (
    <div className="collection-curation">
      <p className="collection-curation__name">
        {identity.name ?? <code className="collection-curation__id">{curationId}</code>}
      </p>
      {identity.curator && <p className="collection-curation__curator">{identity.curator}</p>}
      {identity.place && <p className="collection-curation__place">{identity.place}</p>}
      {identity.concepts.length > 0 && (
        <ul aria-label="Concepts" className="collection-curation__concepts">
          {identity.concepts.map((concept) => <li key={concept}>{concept}</li>)}
        </ul>
      )}
      {!summary && <p className="collection-curation__missing">No longer in the catalog</p>}
    </div>
  )
}
