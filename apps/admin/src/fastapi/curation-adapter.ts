import { readEnv } from '../env'
import type { CurationSort } from '../content/record-types'
import { AdminHttpError } from '../http/errors'
import { normalizeCurationFilters } from '../explorer/normalize-filters'
import { whereParameter } from '../explorer/url-state'
import type { CurationSearchPage, NormalizedCurationFilters } from '../explorer/types'
import type { WithoutCollectionsScanFilters } from '../explorer/without-collections'
import { catalogScanFilters } from '../explorer/without-collections'
import { FastApiAdminClient, FastApiClientError } from '@concierge/fastapi-client'

export interface SearchCurationsInput {
  actorId: string
  cursor: string | null
  filters: NormalizedCurationFilters
  limit: number
  /** The editorial list chooses its order; the boundary default stays as it was. */
  sort?: CurationSort
}

/** One frozen scan of the catalog, opened for the filtered listing. */
export interface ScanCurationsInput {
  actorId: string
  /** Ids the scan must drop: the "Without Collections" view's ledger exclusion. */
  excludeCurationIds: readonly string[]
  filters: NormalizedCurationFilters
  sort?: CurationSort
}

export interface ScanCurationPageInput {
  actorId: string
  cursor: string | null
  limit: number
  scanToken: string
}

/** Server-only boundary to FastAPI. The browser never learns the CMS service key. */
export class CurationAdapter {
  private readonly env = readEnv()
  private readonly client = new FastApiAdminClient({ baseUrl: this.env.fastApiBaseUrl, serviceKey: this.env.cmsServiceKey })

  async search(input: SearchCurationsInput): Promise<CurationSearchPage> {
    const { concepts: conceptFacets, where: whereClauses, ...query } = normalizeCurationFilters(input.filters)
    try {
      return await this.client.searchCurations({
        ...query,
        // Advanced conditions and concept facets are open-ended wire keys, so
        // they ride as repeated query parameters (`where=<json>`,
        // `concept.<Category>=<value>`) instead of the closed query object.
        ...(whereClauses?.length ? { where: whereClauses.map(whereParameter) } : {}),
        cursor: input.cursor,
        limit: input.limit,
        ...(input.sort ? { sort: input.sort } : {}),
      }, input.actorId, conceptFacets ?? []) as CurationSearchPage
    } catch (error) {
      throw this.map(error)
    }
  }

  /**
   * Freezes a catalog scan and returns its token. The boundary keeps the
   * exclusion inside that signed token, so the caller walks one snapshot.
   */
  async startScan(input: ScanCurationsInput): Promise<string> {
    try {
      const result = await this.client.startCatalogScan(this.scanFilters(input), input.actorId)
      return result.scan_token
    } catch (error) {
      throw this.map(error)
    }
  }

  /** One page of Curation ids of a frozen scan, in the scan's own order. */
  async scanPage(input: ScanCurationPageInput): Promise<{ ids: string[]; nextCursor: string | null }> {
    try {
      const page = await this.client.scanCatalogPage(
        { scan_token: input.scanToken, cursor: input.cursor, limit: input.limit },
        input.actorId,
      )
      return { ids: page.items.map((item) => item.curation_id), nextCursor: page.next_cursor ?? null }
    } catch (error) {
      throw this.map(error)
    }
  }

  /**
   * The scan's filter set: the base filters, the requested order and the
   * boundary-only exclusion. The view flag that produced the exclusion is a BFF
   * concern and is dropped by `catalogScanFilters` — the catalog never carries it.
   */
  private scanFilters(input: ScanCurationsInput): WithoutCollectionsScanFilters {
    return catalogScanFilters(input.filters, input.excludeCurationIds, input.sort)
  }

  private map(error: unknown): AdminHttpError {
    if (error instanceof FastApiClientError && (error.status === 401 || error.status === 403)) {
      return new AdminHttpError(403, 'authorization_revoked')
    }
    return new AdminHttpError(503, 'authorization_unavailable')
  }
}
