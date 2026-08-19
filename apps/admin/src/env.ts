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
