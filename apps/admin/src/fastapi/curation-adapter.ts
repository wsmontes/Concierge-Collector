import { readEnv } from '../env'
import { AdminHttpError } from '../http/errors'
import { normalizeCurationFilters } from '../explorer/normalize-filters'
import type { CurationSearchPage, NormalizedCurationFilters } from '../explorer/types'
import { FastApiAdminClient, FastApiClientError } from '@concierge/fastapi-client'

export interface SearchCurationsInput {
  actorId: string
  cursor: string | null
  filters: NormalizedCurationFilters
  limit: number
}

/** Server-only boundary to FastAPI. The browser never learns the CMS service key. */
export class CurationAdapter {
  private readonly env = readEnv()
  private readonly client = new FastApiAdminClient({ baseUrl: this.env.fastApiBaseUrl, serviceKey: this.env.cmsServiceKey })

  async search(input: SearchCurationsInput): Promise<CurationSearchPage> {
    try {
      return await this.client.searchCurations({
        ...normalizeCurationFilters(input.filters), cursor: input.cursor, limit: input.limit,
      }, input.actorId) as CurationSearchPage
    } catch (error) {
      if (error instanceof FastApiClientError && (error.status === 401 || error.status === 403)) {
        throw new AdminHttpError(403, 'authorization_revoked')
      }
      throw new AdminHttpError(503, 'authorization_unavailable')
    }
  }
}
