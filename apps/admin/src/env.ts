export interface AdminEnv {
  cmsMongoUrl: string
  cmsDatabaseName: string
  payloadSecret: string
  publicServerUrl: string
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function readEnv(): AdminEnv {
  return {
    cmsMongoUrl: required('CMS_MONGODB_URL'),
    cmsDatabaseName: process.env.CMS_MONGODB_DB_NAME?.trim() || 'concierge-cms',
    payloadSecret: required('PAYLOAD_SECRET'),
    publicServerUrl: required('CMS_PUBLIC_SERVER_URL'),
  }
}
