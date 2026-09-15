/**
 * Frozen contract between the global search palette and whatever answers a
 * query.
 *
 * `SearchResults` mirrors `GET /api/admin/v1/records/search`: one array per
 * record family, already page-bounded, with no cursor. The palette never
 * fetches by itself beyond the default loader in `search-client.ts`, so a page
 * can mount it against the BFF, a server loader or a test double.
 */

import type { EntityRow } from '../../content/record-types'
import type { AdminCurationRow } from '../../explorer/types'

/** A CMS-local Collection hit, as the same BFF route returns it. */
export interface CollectionHit {
  id: string
  slug: string
  title: string
  lifecycle: string
  draftSelectedCount: number
}

export interface SearchResults {
  entities: EntityRow[]
  curations: AdminCurationRow[]
  collections: CollectionHit[]
}
