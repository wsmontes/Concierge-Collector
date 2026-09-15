import { readEnv } from '../env'
import type { CurationSort } from '../content/record-types'
import { AdminHttpError } from '../http/errors'
import { normalizeCurationFilters } from '../explorer/normalize-filters'
import { whereParameter } from '../explorer/url-state'
import type { CurationSearchPage, NormalizedCurationFilters } from '../explorer/types'
import { FastApiAdminClient, FastApiClientError } from '@concierge/fastapi-client'

export interface SearchCurationsInput {
  actorId: string
  cursor: string | null
  filters: NormalizedCurationFilters
  limit: number
  /** The editorial list chooses its order; the boundary default stays as it was. */
  sort?: CurationSort
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
      if (error instanceof FastApiClientError && (error.status === 401 || error.status === 403)) {
        throw new AdminHttpError(403, 'authorization_revoked')
      }
      throw new AdminHttpError(503, 'authorization_unavailable')
    }
  }
}
