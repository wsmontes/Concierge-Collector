import type { Model } from 'mongoose'

type DocumentModel = Model<Record<string, unknown>>

/**
 * Largest member-id set the Catalog boundary accepts in ONE call. The overview
 * counters (`member_curation_ids`) and the catalog scan exclusion
 * (`exclude_curation_ids`) carry the same member set and share this bound
 * (`concierge-api-v3/app/models/catalog.py` + `catalog_records.py`); a caller
 * that holds more live members must say the set is unavailable instead of
 * sending a partial one, which would silently describe another set.
 */
export const MEMBER_CURATION_ID_LIMIT = 10_000

/**
 * Every Curation id the CMS membership ledger currently holds.
 *
 * A membership row is current while `removedInVersion` is null — the ledger's
 * ONE definition of "this Curation is in a Collection". The overview counters,
 * the "Without Collections" list view and the selection intents that
 * materialize from that view all read the exclusion set through here, so none
 * of them can disagree about which Curations are held.
 */
export async function liveMemberCurationIds(memberships: DocumentModel): Promise<string[]> {
  const ids = (await memberships.distinct('curationId', { removedInVersion: null })) as unknown[]
  return ids.map((id) => String(id)).filter((id) => id.length > 0).sort()
}
