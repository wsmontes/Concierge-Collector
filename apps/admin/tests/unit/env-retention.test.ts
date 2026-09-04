import { afterEach, beforeEach, expect, test } from 'vitest'
import { readArtifactStorageEnv } from '../../src/env'

const ENV_KEYS = [
  'CMS_MONGODB_DB_NAME',
  'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE', 'S3_EXPORT_PREFIX', 'S3_SIGNED_URL_TTL_SECONDS', 'EXPORT_ARTIFACT_TTL_SECONDS',
] as const
const original: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) original[key] = process.env[key]
  process.env.CMS_MONGODB_DB_NAME = 'concierge-cms'
  process.env.S3_ENDPOINT = 'https://s3.example.test'
  process.env.S3_REGION = 'us-east-1'
  process.env.S3_BUCKET = 'concierge-exports'
  process.env.S3_ACCESS_KEY_ID = 'access'
  process.env.S3_SECRET_ACCESS_KEY = 'secret'
  process.env.S3_FORCE_PATH_STYLE = 'false'
  process.env.S3_EXPORT_PREFIX = 'cms/exports'
  process.env.S3_SIGNED_URL_TTL_SECONDS = '300'
  process.env.EXPORT_ARTIFACT_TTL_SECONDS = '604800'
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key]
    else process.env[key] = original[key]
  }
})

test('accepts the seven-day production export artifact retention', () => {
  expect(readArtifactStorageEnv().artifactTtlSeconds).toBe(604800)
})

test('fails closed when production export artifact retention is shortened', () => {
  process.env.EXPORT_ARTIFACT_TTL_SECONDS = '3600'

  expect(() => readArtifactStorageEnv()).toThrow(expect.objectContaining({
    status: 503,
    code: 'service_unavailable',
  }))
})

test('allows shorter export artifact retention on an explicit disposable test database', () => {
  process.env.CMS_MONGODB_DB_NAME = 'concierge-cms-staging-test'
  process.env.EXPORT_ARTIFACT_TTL_SECONDS = '3600'

  expect(readArtifactStorageEnv().artifactTtlSeconds).toBe(3600)
})
