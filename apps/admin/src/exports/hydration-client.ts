import { readEnv } from '../env'
import { AdminHttpError } from '../http/errors'
import type { ExportHydrationClient, HydratedRecord, UnavailableRecord } from './types'

/**
 * Service-key hydration client for the export worker, modeled on the publish
 * availability client. FastAPI resolves only public Curation/Entity fields and
 * reports unavailable ids; the export never receives private material.
 */
export class FastApiExportHydrationClient implements ExportHydrationClient {
  private readonly env = readEnv()

  async introspectAdmin(actorId: string): Promise<void> {
    const response = await this.post('/api/v3/auth/cms/introspect', { subject: actorId }, actorId)
    const identity = await response.json() as { authorized?: unknown; role?: unknown }
    if (identity.authorized !== true || identity.role !== 'admin') throw new AdminHttpError(403, 'authorization_revoked')
  }

  async hydrate(ids: string[]): Promise<{ items: HydratedRecord[]; unavailable: UnavailableRecord[] }> {
    if (!ids.length) return { items: [], unavailable: [] }
    const response = await this.post('/api/v3/internal/curations/hydrate', { curation_ids: ids })
    const payload = await response.json() as { items?: unknown; unavailable?: unknown }
    if (!Array.isArray(payload.items) || !Array.isArray(payload.unavailable)) {
      throw new AdminHttpError(503, 'service_unavailable')
    }
    return {
      items: payload.items.map((row): HydratedRecord => {
        const value = row as { curation_id?: unknown; entity_id?: unknown; name?: unknown; curation_note?: unknown }
        const curationId = typeof value.curation_id === 'string' ? value.curation_id : ''
        const entityId = typeof value.entity_id === 'string' ? value.entity_id : ''
        const name = typeof value.name === 'string' ? value.name : ''
        if (!curationId || !entityId || !name) throw new AdminHttpError(503, 'service_unavailable')
        const curationNote = typeof value.curation_note === 'string' ? value.curation_note : null
        return { curationId, entityId, name, curationNote }
      }),
      unavailable: payload.unavailable.map((row): UnavailableRecord => {
        const value = row as { curation_id?: unknown; reason?: unknown }
        const curationId = typeof value.curation_id === 'string' ? value.curation_id : ''
        const reason = typeof value.reason === 'string' ? value.reason : ''
        if (!curationId || !reason) throw new AdminHttpError(503, 'service_unavailable')
        return { curationId, reason }
      }),
    }
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
      throw new AdminHttpError(503, 'service_unavailable')
    }
    if (response.status === 401 || response.status === 403) throw new AdminHttpError(403, 'authorization_revoked')
    if (!response.ok) throw new AdminHttpError(503, 'service_unavailable')
    return response
  }
}
