import type { AdminCurationRow } from '../../explorer/types'

export interface RelationshipMember {
  curationId: string
  summary: AdminCurationRow | null
}

export interface LoadedRelationships {
  /** Curations the loaded page actually holds. */
  curations: number
  /** Distinct Entities those Curations represent, by stored name. */
  entities: number
  /** Distinct Curators behind them, by stored curator id or name. */
  curators: number
  /** Loaded members with no catalog row: unattributable, and not counted. */
  withoutSummary: number
}

function normalized(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLocaleLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Relationship counts over the loaded page, and nothing beyond it (§26).
 *
 * The counts describe exactly the member rows the caller holds: a bounded page
 * is reported as bounded instead of being extrapolated into a Collection total,
 * and a member whose catalog row is gone cannot be attributed to an Entity or a
 * Curator, so it is left out of those counts and reported separately.
 */
export function relationshipsOf(members: readonly RelationshipMember[]): LoadedRelationships {
  const summaries = members
    .map((member) => member.summary)
    .filter((summary): summary is AdminCurationRow => summary !== null)
  const entityNames = new Set<string>()
  const curatorKeys = new Set<string>()
  for (const summary of summaries) {
    const name = normalized(summary.restaurant_name)
    if (name) entityNames.add(name)
    const curator = normalized(summary.curator_id) ?? normalized(summary.curator_name)
    if (curator) curatorKeys.add(curator)
  }
  return {
    curations: members.length,
    entities: entityNames.size,
    curators: curatorKeys.size,
    withoutSummary: members.length - summaries.length,
  }
}

function count(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

/**
 * The Collection's Relationships card. It reads the loaded member page and says
 * which page it read; it never presents a bounded count as a Collection total.
 */
export function CollectionRelationships({
  members,
  hasMore = false,
}: {
  members: readonly RelationshipMember[]
  hasMore?: boolean
}) {
  const relationships = relationshipsOf(members)
  return (
    <section className="collection-relationships" aria-labelledby="collection-relationships-title">
      <h2 id="collection-relationships-title">Relationships</h2>
      {relationships.curations === 0 ? (
        <p className="collection-relationships__empty">No members loaded yet.</p>
      ) : (
        <>
          <dl className="collection-relationships__facts">
            <div><dt>Curations</dt><dd>{count(relationships.curations)}</dd></div>
            <div><dt>Entities represented</dt><dd>{count(relationships.entities)}</dd></div>
            <div><dt>Curators represented</dt><dd>{count(relationships.curators)}</dd></div>
          </dl>
          <p className="collection-relationships__note">
            {hasMore
              ? `Based on the first ${count(relationships.curations)} members.`
              : `Based on all ${count(relationships.curations)} loaded members.`}
          </p>
          {relationships.withoutSummary > 0 && (
            <p className="collection-relationships__note">
              {count(relationships.withoutSummary)}
              {relationships.withoutSummary === 1
                ? ' loaded member is no longer in the catalog and is not counted.'
                : ' loaded members are no longer in the catalog and are not counted.'}
            </p>
          )}
        </>
      )}
    </section>
  )
}
