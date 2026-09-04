import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const actor = {
  authz_revision: 'revision-1', authorized: true, email: 'admin@example.test', name: 'Admin', picture: null,
  role: 'admin' as const, user_id: 'admin-1',
}
const readUrl = vi.fn(async () => 'https://s3.example.test/private')

vi.mock('../../../src/http/with-admin', () => ({
  withAdmin: (handler: (request: Request, currentActor: typeof actor) => Promise<Response>) =>
    (request: Request) => handler(request, actor),
}))
vi.mock('../../../src/exports/export-selection', () => ({
  asRecord: (value: unknown) => value,
  createExport: vi.fn(),
}))
vi.mock('../../../src/storage/s3-artifact-store', () => ({
  createS3ArtifactStore: () => ({ put: vi.fn(), delete: vi.fn(), readUrl }),
}))

const ENV_KEYS = [
  'CMS_MONGODB_DB_NAME',
  'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE', 'S3_EXPORT_PREFIX', 'S3_SIGNED_URL_TTL_SECONDS', 'EXPORT_ARTIFACT_TTL_SECONDS',
] as const
const original: Record<string, string | undefined> = {}

beforeEach(() => {
  readUrl.mockClear()
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

test('GET returns 410 for an expired complete export and never signs its object', async () => {
  const expired = {
    _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', selectionId: 'ffffffffffffffffffffffff', actorId: 'admin-1',
    format: 'ndjson', status: 'complete', progress: { processed: 3 },
    key: 'cms/exports/selection/export.ndjson', contentType: 'application/x-ndjson', sha256: 'ab'.repeat(32),
    expiresAt: new Date(Date.now() - 1_000), idempotencyKey: 'k', requestHash: 'h', requestId: 'r',
    payloadJobId: 'job-1', leaseOwner: null, leaseExpiresAt: null, fencingToken: 1,
  }
  const payload = {
    db: { collections: {
      'collection-exports': { findOne: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(expired) }) },
    } },
  }
  const { exportEndpoints } = await import('../../../src/payload/endpoints/exports')
  const endpoint = exportEndpoints().find(({ method, path }) => method === 'get' && path === '/admin/v1/exports/:id')
  const request = Object.assign(new Request('https://admin.example.test/api/admin/v1/exports/bbbbbbbbbbbbbbbbbbbbbbbb'), {
    payload, routeParams: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
  })

  const response = await endpoint!.handler(request as never)

  expect(response.status).toBe(410)
  expect(await response.json()).toMatchObject({ error: { code: 'export_expired' } })
  expect(readUrl).not.toHaveBeenCalled()
})
