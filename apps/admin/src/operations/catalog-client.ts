import { readEnv } from '../env'
import { AdminHttpError } from '../http/errors'
import type { CatalogResolver, ResolvedCurations } from './types'

interface CmsAuthorization { authorized: boolean; role: string }

/** Narrow client; actor identity is always supplied by `withAdmin`, never body input. */
export class FastApiCatalogClient implements CatalogResolver {
  private readonly env = readEnv()

  async resolveCurations(ids: string[], actorId: string): Promise<ResolvedCurations> {
    const response = await this.post('/api/v3/catalog/curations/resolve', actorId, { curation_ids: ids })
    const result = await response.json() as { eligible_ids: string[]; rejected: Array<{ curation_id: string; reason: 'not_found' | 'ineligible_status' }> }
    return {
      eligibleIds: result.eligible_ids,
      rejected: result.rejected.map((item) => ({ curationId: item.curation_id, reason: item.reason })),
    }
  }

  async introspectAdmin(actorId: string): Promise<void> {
    const response = await this.post('/api/v3/auth/cms/introspect', actorId, { subject: actorId })
    const identity = await response.json() as CmsAuthorization
    if (!identity.authorized || identity.role !== 'admin') throw new AdminHttpError(403, 'authorization_revoked')
  }

  private async post(path: string, actorId: string, body: unknown): Promise<Response> {
    let response: Response
    try {
      response = await fetch(`${this.env.fastApiBaseUrl}${path}`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CMS-Actor-Id': actorId,
          'X-CMS-Service-Key': this.env.cmsServiceKey,
        },
        body: JSON.stringify(body),
      })
    } catch {
      throw new AdminHttpError(503, 'authorization_unavailable')
    }
    if (response.status === 401 || response.status === 403) throw new AdminHttpError(403, 'authorization_revoked')
    if (!response.ok) throw new AdminHttpError(503, 'authorization_unavailable')
    return response
  }
}
