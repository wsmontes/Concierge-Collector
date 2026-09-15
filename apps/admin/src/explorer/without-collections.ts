import type { AdminCurationRow, CatalogFilters } from '@concierge/fastapi-client'
import type { CurationSort } from '../content/record-types'
import type { NormalizedCurationFilters } from './types'

/**
 * Scan filters of the "Without Collections" view.
 *
 * `exclude_curation_ids` belongs to the catalog scan contract
 * (`concierge-api-v3/app/models/catalog.py`, `EXCLUDE_CURATION_IDS_MAX`): the
 * boundary drops those ids from the set a frozen scan materializes. The
 * committed generated client predates the field, so the BFF states the shape it
 * needs here; regenerating the contract (`npm run generate
 * --workspace=@concierge/fastapi-client`) lets this alias collapse into
 * `CatalogFilters`.
 */
export type WithoutCollectionsScanFilters = CatalogFilters & { exclude_curation_ids: string[] }

/** The status vocabulary the catalog scan body declares (the listing accepts any string). */
const SCAN_STATUSES = ['draft', 'linked', 'active', 'deleted', 'archived'] as const

type ScanStatus = (typeof SCAN_STATUSES)[number]

/**
 * The filter set of one scan: the base filters, the requested order and the
 * exclusion. The "Without Collections" view is a composition of the two, but
 * the scan itself never hears about that view — it just carries one more
 * predicate.
 *
 * `status` is narrowed to the vocabulary the scan body declares, because the
 * listing takes an open status list (`CatalogSearchQuery['status']`): a status
 * the boundary cannot express is dropped here instead of being sent on to be
 * rejected there.
 */
export function catalogScanFilters(
  filters: NormalizedCurationFilters,
  excludeCurationIds: readonly string[],
  sort?: CurationSort,
): WithoutCollectionsScanFilters {
  const { status, without_collections: _viewMode, ...rest } = filters
  const statuses = status?.filter((value): value is ScanStatus => (SCAN_STATUSES as readonly string[]).includes(value))
  return {
    ...rest,
    ...(sort ? { sort } : {}),
    ...(statuses?.length ? { status: statuses } : {}),
    // An empty exclusion drops nothing: absence of the key is "no exclusion".
    exclude_curation_ids: [...excludeCurationIds],
  }
}

/** The boundary batch size `curationSummaries` accepts in one call. */
export const SUMMARIES_BATCH_SIZE = 200

/** The largest page the catalog scan serves in one call. */
export const SCAN_PAGE_LIMIT = 500

const CURSOR_VERSION = 1

/**
 * The slice of the catalog boundary this view needs: one frozen scan, walked in
 * pages of Curation ids. `CurationAdapter` implements it, so the BFF route can
 * hand the adapter over as the seam (and tests can hand over a fake one).
 */
export interface WithoutCollectionsScan {
  /** Freezes a scan over the base filters plus the ledger exclusion. */
  startScan(input: {
    actorId: string
    excludeCurationIds: readonly string[]
    filters: NormalizedCurationFilters
    sort?: CurationSort
  }): Promise<string>
  /** One boundary page of the frozen scan, in the scan's own order. */
  scanPage(input: {
    actorId: string
    cursor: string | null
    limit: number
    scanToken: string
  }): Promise<{ ids: string[]; nextCursor: string | null }>
}

/**
 * The list page of the filtered view. `items` are the boundary's own list rows
 * (`curationSummaries`), keyed by the ids the scan produced.
 */
export interface WithoutCollectionsPage {
  items: AdminCurationRow[]
  next_cursor: string | null
  /**
   * Deliberately unknown: the exhaustive count of this view is the
   * content-health counter, never the length of a materialized page.
   */
  total: null
}

export interface WithoutCollectionsPageInput {
  actorId: string
  cursor: string | null
  /** The base listing filters. The exclusion is derived from the ledger instead. */
  filters: NormalizedCurationFilters
  limit: number
  /** Live member Curation ids, read from the CMS membership ledger by the caller. */
  memberCurationIds: readonly string[]
  rowsFor: (curationIds: string[], actorId: string) => Promise<AdminCurationRow[]>
  scan: WithoutCollectionsScan
  sort?: CurationSort
}

/**
 * Cursor of the filtered view: the row offset inside the scan's snapshot.
 *
 * It is deliberately tiny and holds nothing else. The boundary's own scan token
 * carries the whole exclusion set (up to 10 000 ids), so it can never travel in
 * a browser URL — this cursor is what the operator's URL carries instead.
 */
export function withoutCollectionsCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset, v: CURSOR_VERSION }), 'utf8').toString('base64url')
}

/** The offset a cursor names; a cursor this view did not mint restarts at the first page. */
export function withoutCollectionsOffset(cursor: string | null): number {
  if (!cursor) return 0
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>
    if (value.v !== CURSOR_VERSION || !Number.isInteger(value.offset)) return 0
    const offset = value.offset as number
    return offset >= 0 ? offset : 0
  } catch {
    return 0
  }
}

/**
 * `curationSummaries` accepts a bounded batch, so a page larger than one batch
 * is fetched in order in as many calls as it needs.
 */
export function summariesRowsFor(
  summaries: (curationIds: string[], actorId: string) => Promise<AdminCurationRow[]>,
): (curationIds: string[], actorId: string) => Promise<AdminCurationRow[]> {
  return async (curationIds, actorId) => {
    const rows: AdminCurationRow[] = []
    for (let start = 0; start < curationIds.length; start += SUMMARIES_BATCH_SIZE) {
      rows.push(...(await summaries(curationIds.slice(start, start + SUMMARIES_BATCH_SIZE), actorId)))
    }
    return rows
  }
}

/**
 * One page of the "Without Collections" listing.
 *
 * The view is a composition, not a boundary listing: the CMS holds the
 * membership ledger, so the BFF freezes a catalog scan over the base filters
 * plus the ledger exclusion and reads the page out of it. Nothing here invents
 * a Curation: the ids are the scan's, the rows are the boundary's summaries and
 * the exclusion is the ledger's.
 *
 * Snapshot semantics: each request materializes its own frozen scan, so the
 * rows of one page always come from a single snapshot (a Curation is never both
 * included and excluded inside one page). That snapshot is per request, not per
 * view: the boundary's scan token lives 15 minutes and is never stored by this
 * BFF, so pages are not a stable keyset walk — a Curation edited between two
 * page requests can move, exactly like any offset-paginated listing over a live
 * collection. The membership ledger is read per request too, which keeps the
 * view honest while Collections change. If a walk ever outlives the token's TTL
 * the boundary answers `409`, which surfaces as a failed page the operator can
 * retry — there is no half-materialized page.
 */
export async function withoutCollectionsPage(
  input: WithoutCollectionsPageInput,
): Promise<WithoutCollectionsPage> {
  const offset = withoutCollectionsOffset(input.cursor)
  const target = offset + input.limit
  const scanToken = await input.scan.startScan({
    actorId: input.actorId,
    excludeCurationIds: input.memberCurationIds,
    filters: input.filters,
    ...(input.sort ? { sort: input.sort } : {}),
  })

  const ids: string[] = []
  let cursor: string | null = null
  let exhausted = false
  while (ids.length < target && !exhausted) {
    const page = await input.scan.scanPage({
      actorId: input.actorId,
      cursor,
      limit: Math.min(SCAN_PAGE_LIMIT, target - ids.length),
      scanToken,
    })
    ids.push(...page.ids)
    cursor = page.nextCursor
    // A page that advances nothing ends the walk: never loop on a stalled scan.
    exhausted = page.nextCursor === null || page.ids.length === 0
  }

  const pageIds = ids.slice(offset, target)
  const rows = pageIds.length === 0 ? [] : await input.rowsFor(pageIds, input.actorId)
  return {
    // Every row of this view sits outside the set the exclusion was built from,
    // so its Collections count is a known zero, not an unmeasured value.
    items: rows.map((row) => ({ ...row, collections_count: 0 })),
    next_cursor: ids.length === target && !exhausted ? withoutCollectionsCursor(target) : null,
    total: null,
  }
}
