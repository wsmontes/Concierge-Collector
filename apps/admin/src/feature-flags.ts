import type { Endpoint, PayloadRequest } from 'payload'
import { AdminHttpError } from './http/errors'

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
  const deployment = process.env.ENVIRONMENT?.trim().toLowerCase()
  return process.env.NODE_ENV === 'production' || deployment === 'production' || deployment === 'staging'
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
  if (!featureEnabled(name)) {
    throw new AdminHttpError(503, 'feature_disabled', { flag: name })
  }
}

/** Wrap Payload custom endpoints without trusting the client/UI flag state. */
export function guardFeatureEndpoints(name: CollectionsFeatureFlag, endpoints: Endpoint[]): Endpoint[] {
  return endpoints.map((endpoint) => {
    const handler = endpoint.handler
    return {
      ...endpoint,
      handler: async (request: PayloadRequest) => {
        requireFeature(name)
        return handler(request)
      },
    }
  })
}
