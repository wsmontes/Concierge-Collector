import { AdminHttpError } from './http/errors'

export interface AdminEnv {
  collectorOrigins: string[]
  cmsMongoUrl: string
  cmsDatabaseName: string
  cmsServiceKey: string
  fastApiBaseUrl: string
  metricsKey: string
  payloadSecret: string
  publicServerUrl: string
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function canonicalOrigin(value: string, name: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must contain valid HTTP(S) origins`)
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must contain origins without paths or credentials`)
  }

  return url.origin
}

function collectorOrigins(): string[] {
  const value = process.env.CMS_COLLECTOR_ORIGINS?.trim()
  if (!value) return []

  return value.split(',').map((origin) => canonicalOrigin(origin.trim(), 'CMS_COLLECTOR_ORIGINS'))
}

export interface ArtifactStorageEnv {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  exportPrefix: string
  signedUrlTtlSeconds: number
  artifactTtlSeconds: number
}

function optionalBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim()
  if (raw === undefined || raw === '') return fallback
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new AdminHttpError(503, 'service_unavailable')
}

function requiredPositiveIntEnv(name: string): number {
  const raw = process.env[name]?.trim()
  const value = raw === undefined ? NaN : Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new AdminHttpError(503, 'service_unavailable')
  return value
}

/**
 * Private artifact storage configuration, read LAZILY by the export route and
 * job (never at boot) so development and tests without S3 stay unaffected.
 * Any missing/invalid variable fails closed with 503 at the first real use.
 */
export function readArtifactStorageEnv(): ArtifactStorageEnv {
  const required = (name: string): string => {
    const value = process.env[name]?.trim()
    if (!value) throw new AdminHttpError(503, 'service_unavailable')
    return value
  }
  return {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: optionalBooleanEnv('S3_FORCE_PATH_STYLE', false),
    exportPrefix: required('S3_EXPORT_PREFIX'),
    signedUrlTtlSeconds: requiredPositiveIntEnv('S3_SIGNED_URL_TTL_SECONDS'),
    artifactTtlSeconds: requiredPositiveIntEnv('EXPORT_ARTIFACT_TTL_SECONDS'),
  }
}

export function readEnv(): AdminEnv {
  return {
    collectorOrigins: collectorOrigins(),
    cmsMongoUrl: required('CMS_MONGODB_URL'),
    cmsDatabaseName: process.env.CMS_MONGODB_DB_NAME?.trim() || 'concierge-cms',
    cmsServiceKey: required('CMS_SERVICE_KEY'),
    fastApiBaseUrl: required('FASTAPI_BASE_URL').replace(/\/$/, ''),
    // Absence fails closed at the metrics route (401) rather than preventing
    // liveness/readiness from starting. Production provisioning must set it.
    metricsKey: process.env.METRICS_KEY?.trim() || '',
    payloadSecret: required('PAYLOAD_SECRET'),
    publicServerUrl: canonicalOrigin(required('CMS_PUBLIC_SERVER_URL'), 'CMS_PUBLIC_SERVER_URL'),
  }
}
