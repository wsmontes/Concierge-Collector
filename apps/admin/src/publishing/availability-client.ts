import { readEnv } from '../env'
import { AdminHttpError } from '../http/errors'
import type { PublishAvailabilityClient } from './types'

/** Service-key client for live availability, never a cached source of truth. */
export class FastApiPublishAvailabilityClient implements PublishAvailabilityClient {
  private readonly env = readEnv()

  async hydrateCurations(ids: string[]): Promise<{ availableCount: number; unavailableCount: number }> {
    const response = await this.post('/api/v3/internal/curations/hydrate', { curation_ids: ids })
    const payload = await response.json() as { available_count?: unknown; unavailable_count?: unknown }
    if (!Number.isInteger(payload.available_count) || !Number.isInteger(payload.unavailable_count)) {
      throw new AdminHttpError(503, 'service_unavailable')
    }
    return { availableCount: payload.available_count as number, unavailableCount: payload.unavailable_count as number }
  }

  async introspectAdmin(actorId: string): Promise<void> {
    const response = await this.post('/api/v3/auth/cms/introspect', { subject: actorId }, actorId)
    const identity = await response.json() as { authorized?: unknown; role?: unknown }
    if (identity.authorized !== true || identity.role !== 'admin') throw new AdminHttpError(403, 'authorization_revoked')
  }

  private async post(path: string, body: unknown, actorId?: string): Promise<Response> {
    let response: Response
    try {
      response = await fetch(`${this.env.fastApiBaseUrl}${path}`, {
        method: 'POST', cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CMS-Service-Key': this.env.cmsServiceKey,
          ...(actorId ? { 'X-CMS-Actor-Id': actorId } : {}),
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
