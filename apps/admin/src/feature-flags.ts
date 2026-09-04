import type { Endpoint, PayloadRequest } from 'payload'
import { AdminHttpError, adminErrorResponse } from './http/errors'

export type CollectionsFeatureFlag =
  | 'cms_auth'
  | 'catalog_scan'
  | 'collections_admin'
  | 'collector_association_read'
  | 'collector_draft_mutation'
  | 'consumer_credentials'
  | 'collections_distribution'

const FLAG_ENVS: Record<CollectionsFeatureFlag, string> = {
  cms_auth: 'CMS_AUTH_ENABLED',
  catalog_scan: 'CATALOG_SCAN_ENABLED',
  collections_admin: 'COLLECTIONS_ADMIN_ENABLED',
  collector_association_read: 'COLLECTOR_ASSOCIATION_READ_ENABLED',
  collector_draft_mutation: 'COLLECTOR_DRAFT_MUTATION_ENABLED',
  consumer_credentials: 'CONSUMER_CREDENTIALS_ENABLED',
  collections_distribution: 'COLLECTIONS_DISTRIBUTION_ENABLED',
}

function productionLike(): boolean {
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase()
  const deployment = process.env.ENVIRONMENT?.trim().toLowerCase()

  if (nodeEnv === 'production' || deployment === 'production' || deployment === 'staging') return true
  if (nodeEnv || deployment) return false
  // Match FastAPI's fail-safe environment policy: an unclassified deployment
  // must not silently enable staged production capabilities.
  return true
}

export function featureEnabled(name: CollectionsFeatureFlag): boolean {
  const envName = FLAG_ENVS[name]
  const raw = process.env[envName]?.trim().toLowerCase()
  if (!raw) return !productionLike()
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${envName} must be true or false`)
}

export function requireFeature(name: CollectionsFeatureFlag): void {
  if (!featureEnabled(name)) throw new AdminHttpError(503, 'feature_disabled', { flag: name })
}

/** Wrap Payload custom endpoints without trusting client/UI feature state. */
export function guardFeatureEndpoints(name: CollectionsFeatureFlag, endpoints: Endpoint[]): Endpoint[] {
  return endpoints.map((endpoint) => {
    const handler = endpoint.handler
    return {
      ...endpoint,
      handler: async (request: PayloadRequest) => {
        try {
          requireFeature(name)
        } catch (error) {
          return adminErrorResponse(error)
        }
        return handler(request)
      },
    }
  })
}