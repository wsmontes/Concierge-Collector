import { FastApiAdminClient, FastApiClientError } from '@concierge/fastapi-client'
import { readEnv } from '../env'
import { AdminHttpError } from '../http/errors'
import { catalogScanFilters } from '../explorer/without-collections'
import type { SelectionCatalogClient } from './types'

/** Typed catalog boundary used by manifest creation and worker materialization. */
export class FastApiSelectionCatalogClient implements SelectionCatalogClient {
  private readonly client = new FastApiAdminClient({
    baseUrl: readEnv().fastApiBaseUrl,
    serviceKey: readEnv().cmsServiceKey,
  })

  async introspectAdmin(actorId: string): Promise<void> {
    try {
      const identity = await this.client.introspect({ subject: actorId })
      if (!identity.authorized || identity.role !== 'admin') throw new AdminHttpError(403, 'authorization_revoked')
    } catch (error) {
      if (error instanceof AdminHttpError) throw error
      throw this.map(error)
    }
  }

  async resolveCurations(ids: string[], actorId: string) {
    try {
      const result = await this.client.resolveCurations({ curation_ids: ids }, actorId)
      return { eligibleIds: result.eligible_ids, rejected: result.rejected.map((item) => ({ curationId: item.curation_id, reason: item.reason })) }
    } catch (error) {
      throw this.map(error)
    }
  }

  async startScan(
    filters: Parameters<SelectionCatalogClient['startScan']>[0],
    actorId: string,
    excludeCurationIds: readonly string[] = [],
  ) {
    try {
      // A materialized selection is a SET: order never changes which Curations
      // are eligible, so the scan keeps the boundary's own default ordering
      // (`catalog_sequence`), which is also the list's tie-breaker. The
      // "Without Collections" mode is a CMS-side composition, so the boundary
      // receives the exclusion the membership ledger produced, never the flag
      // that asked for it.
      const result = await this.client.startCatalogScan(
        catalogScanFilters(filters, excludeCurationIds, 'sequence_asc'),
        actorId,
      )
      return { maxCatalogSequence: result.max_catalog_sequence, scanToken: result.scan_token }
    } catch (error) {
      throw this.map(error)
    }
  }

  async scanPage(input: Parameters<SelectionCatalogClient['scanPage']>[0]) {
    try {
      const page = await this.client.scanCatalogPage({ scan_token: input.scanToken, cursor: input.cursor, limit: input.limit }, input.actorId)
      return { items: page.items.map((item) => ({ curation_id: item.curation_id })), next_cursor: page.next_cursor ?? null }
    } catch (error) {
      throw this.map(error)
    }
  }

  private map(error: unknown): AdminHttpError {
    if (error instanceof FastApiClientError && (error.status === 401 || error.status === 403)) {
      return new AdminHttpError(403, 'authorization_revoked')
    }
    return new AdminHttpError(503, 'authorization_unavailable')
  }
}
