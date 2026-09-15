import type {
  ContentHealthResponse,
  CurationSummariesResponse,
  EntityCurationsPage,
  EntityListPage,
} from '@concierge/fastapi-client'
import { FastApiAdminClient, FastApiClientError } from '@concierge/fastapi-client'
import { readEnv } from '../env'
import { AdminHttpError } from '../http/errors'

export interface EntityPageInput {
  actorId: string
  query: string | null
  type: string | null
  status: string | null
  afterId: string | null
  limit: number
}

export interface SaveRecordInput {
  actorId: string
  role: string
  recordId: string
  updates: Record<string, unknown>
  expectedVersion: number
}

/**
 * Server-only boundary for the editorial record surfaces.
 *
 * The browser never learns the CMS service key: every call derives the actor
 * and the credential here, exactly like the Explorer's `CurationAdapter`.
 */
export class RecordsAdapter {
  private readonly env = readEnv()
  private readonly client = new FastApiAdminClient({
    baseUrl: this.env.fastApiBaseUrl,
    serviceKey: this.env.cmsServiceKey,
  })

  async curationRecord(curationId: string, actorId: string): Promise<Record<string, unknown>> {
    const response = await this.call(() => this.client.curationRecord(curationId, actorId))
    return response.record
  }

  async entityRecord(entityId: string, actorId: string): Promise<Record<string, unknown>> {
    const response = await this.call(() => this.client.entityRecord(entityId, actorId))
    return response.record
  }

  entityPage(input: EntityPageInput): Promise<EntityListPage> {
    return this.call(() => this.client.searchEntities({
      q: input.query,
      type: input.type,
      status: input.status,
      after_id: input.afterId,
      limit: input.limit,
    }, input.actorId))
  }

  entityCurations(entityId: string, actorId: string, limit: number): Promise<EntityCurationsPage> {
    return this.call(() => this.client.entityCurations(entityId, { limit }, actorId))
  }

  /**
   * Editorial dashboard counters. The CMS membership ledger supplies the live
   * member Curation ids; the boundary answers every counter, including
   * `without_collections` against exactly those ids.
   */
  contentHealth(memberCurationIds: readonly string[], actorId: string): Promise<ContentHealthResponse> {
    return this.call(() => this.client.contentHealth(
      { member_curation_ids: [...memberCurationIds] },
      actorId,
    ))
  }

  /**
   * Editorial rows for a batch of Curations, in one boundary call.
   *
   * The Collections read models need one human label per member, and resolving
   * each id separately would turn a single page into N requests. The ids the
   * catalog no longer holds come back simply absent from `items`; the caller
   * renders those as missing rather than inventing a row.
   */
  curationSummaries(curationIds: string[], actorId: string): Promise<CurationSummariesResponse> {
    return this.call(() => this.client.curationSummaries(curationIds, actorId))
  }

  async saveCuration(input: SaveRecordInput): Promise<Record<string, unknown>> {
    const response = await this.call(() => this.client.updateCurationRecord(input.recordId, {
      updates: input.updates,
      expectedVersion: input.expectedVersion,
    }, input.actorId, input.role))
    return response.record
  }

  async saveEntity(input: SaveRecordInput): Promise<Record<string, unknown>> {
    const response = await this.call(() => this.client.updateEntityRecord(input.recordId, {
      updates: input.updates,
      expectedVersion: input.expectedVersion,
    }, input.actorId, input.role))
    return response.record
  }

  /** Maps boundary failures onto the Admin error contract that the browser already knows. */
  private async call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      if (!(error instanceof FastApiClientError)) throw new AdminHttpError(503, 'service_unavailable')
      switch (error.status) {
        case 400:
        case 422:
          throw new AdminHttpError(400, 'invalid_request')
        case 401:
        case 403:
          throw new AdminHttpError(403, 'authorization_revoked')
        case 404:
          throw new AdminHttpError(404, 'not_found')
        case 409:
          throw new AdminHttpError(409, 'conflict')
        case 412:
        case 428:
          throw new AdminHttpError(412, 'precondition_failed')
        default:
          throw new AdminHttpError(503, 'service_unavailable')
      }
    }
  }
}
