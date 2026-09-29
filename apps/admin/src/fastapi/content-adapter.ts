import { FastApiAdminClient, FastApiClientError, type ContentRecordResponse } from '@concierge/fastapi-client'
import { readEnv } from '../env'
import { AdminHttpError } from '../http/errors'

/**
 * Server-only boundary that hands the Admin one whole record.
 *
 * Unlike the Explorer search (an allowlisted summary row), the editorial
 * surfaces must not lose fields the Admin does not model yet — a field the UI
 * has no component for still has to be readable and auditable.
 */
export class ContentRecordAdapter {
  private readonly env = readEnv()
  private readonly client = new FastApiAdminClient({
    baseUrl: this.env.fastApiBaseUrl,
    serviceKey: this.env.cmsServiceKey,
  })

  curation(curationId: string): Promise<ContentRecordResponse> {
    return this.load(() => this.client.curationRecord(curationId))
  }

  entity(entityId: string): Promise<ContentRecordResponse> {
    return this.load(() => this.client.entityRecord(entityId))
  }

  patchCuration(
    curationId: string,
    fields: Record<string, unknown>,
    version: number,
    actorId: string,
  ): Promise<ContentRecordResponse> {
    return this.load(() => this.client.patchCurationRecord(curationId, fields, version, actorId))
  }

  private async load(request: () => Promise<ContentRecordResponse>): Promise<ContentRecordResponse> {
    try {
      return await request()
    } catch (error) {
      if (error instanceof FastApiClientError) {
        if (error.status === 401 || error.status === 403) throw new AdminHttpError(403, 'authorization_revoked')
        if (error.status === 404) throw new AdminHttpError(404, 'not_found')
        if (error.status === 400) throw new AdminHttpError(400, 'invalid_request')
        // A version fence that no longer matches is a conflict the editor must
        // resolve, not an outage. `revision_conflict` is the 412 code, so an
        // upstream 409 must use `conflict` — the code table is checked against
        // the status and a mismatch degrades to 503.
        if (error.status === 409) throw new AdminHttpError(409, 'conflict')
        if (error.status === 412) throw new AdminHttpError(412, 'precondition_failed')
      }
      throw new AdminHttpError(503, 'authorization_unavailable')
    }
  }
}
