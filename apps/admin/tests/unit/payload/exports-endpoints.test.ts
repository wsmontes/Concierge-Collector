import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const actor = {
  authz_revision: 'revision-1', authorized: true, email: 'admin@example.test', name: 'Admin', picture: null,
  role: 'admin' as const, user_id: 'admin-1',
}

const createExport = vi.fn()
const retainSelectionForAudit = vi.fn().mockResolvedValue(undefined)
const readUrl = vi.fn(async () => 'https://s3.example.test/private/cms/exports/x.ndjson?X-Amz-Signature=short-lived')
const fakeStore = { put: vi.fn(), readUrl, delete: vi.fn() }

vi.mock('../../../src/http/with-admin', () => ({
  withAdmin: (handler: (request: Request, currentActor: typeof actor) => Promise<Response>) =>
    (request: Request) => handler(request, actor),
}))

vi.mock('../../../src/exports/export-selection', () => ({
  asRecord: (value: unknown) => value,
  createExport,
}))

vi.mock('../../../src/selections/retention', () => ({ retainSelectionForAudit }))

vi.mock('../../../src/storage/s3-artifact-store', () => ({
  createS3ArtifactStore: () => fakeStore,
}))

const S3_KEYS = [
  'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE', 'S3_EXPORT_PREFIX', 'S3_SIGNED_URL_TTL_SECONDS', 'EXPORT_ARTIFACT_TTL_SECONDS',
] as const

describe('Export endpoints', () => {
  const realEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    createExport.mockReset()
    retainSelectionForAudit.mockReset().mockResolvedValue(undefined)
    for (const key of S3_KEYS) {
      realEnv[key] = process.env[key]
      process.env[key] = {
        S3_ENDPOINT: 'https://s3.example.test',
        S3_REGION: 'us-east-1',
        S3_BUCKET: 'concierge-exports',
        S3_ACCESS_KEY_ID: 'access',
        S3_SECRET_ACCESS_KEY: 'secret',
        S3_FORCE_PATH_STYLE: 'false',
        S3_EXPORT_PREFIX: 'cms/exports',
        S3_SIGNED_URL_TTL_SECONDS: '300',
        EXPORT_ARTIFACT_TTL_SECONDS: '604800',
      }[key]
    }
  })

  afterEach(() => {
    for (const key of S3_KEYS) {
      if (realEnv[key] === undefined) delete process.env[key]
      else process.env[key] = realEnv[key]
    }
  })

  test('POST retains the selection before it commits an export intent', async () => {
    createExport.mockResolvedValueOnce({
      id: 'dddddddddddddddddddddddd', selectionId: 'ffffffffffffffffffffffff', format: 'ndjson', status: 'queued',
      progress: {}, sha256: null,
    })
    const { exportEndpoints } = await import('../../../src/payload/endpoints/exports')
    const endpoint = exportEndpoints().find(({ method, path }) => method === 'post' && path === '/admin/v1/selections/:selectionId/exports')
    const request = Object.assign(new Request('https://admin.example.test/api/admin/v1/selections/selection-1/exports', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'export-key', 'x-request-id': 'request-1' },
      body: JSON.stringify({ format: 'ndjson' }),
    }), { payload: {}, routeParams: { selectionId: 'ffffffffffffffffffffffff' } })

    const response = await endpoint!.handler(request as never)

    expect(response.status).toBe(202)
    expect(retainSelectionForAudit).toHaveBeenCalledWith({}, expect.objectContaining({
      selectionId: 'ffffffffffffffffffffffff', actorId: 'admin-1', now: expect.any(Date),
    }))
    expect(createExport).toHaveBeenCalledWith({}, {
      selectionId: 'ffffffffffffffffffffffff', actorId: 'admin-1', format: 'ndjson',
      idempotencyKey: 'export-key', requestId: 'request-1',
    }, undefined, { artifactTtlSeconds: 604800 })
    expect(retainSelectionForAudit.mock.invocationCallOrder[0]).toBeLessThan(createExport.mock.invocationCallOrder[0])
    const payload = await response.json()
    expect(payload.status).toBe('queued')
    expect(payload.downloadUrl).toBeUndefined()
  })

  test('POST does not create export evidence when selection retention fails', async () => {
    retainSelectionForAudit.mockRejectedValueOnce(new Error('retention unavailable'))
    const { exportEndpoints } = await import('../../../src/payload/endpoints/exports')
    const endpoint = exportEndpoints().find(({ method, path }) => method === 'post' && path === '/admin/v1/selections/:selectionId/exports')
    const request = Object.assign(new Request('https://admin.example.test/api/admin/v1/selections/selection-1/exports', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'export-key', 'x-request-id': 'request-1' },
      body: JSON.stringify({ format: 'ndjson' }),
    }), { payload: {}, routeParams: { selectionId: 'ffffffffffffffffffffffff' } })

    const response = await endpoint!.handler(request as never)

    expect(response.status).toBe(503)
    expect(createExport).not.toHaveBeenCalled()
  })

  test('POST rejects a missing idempotency header or unknown format', async () => {
    const { exportEndpoints } = await import('../../../src/payload/endpoints/exports')
    const endpoint = exportEndpoints().find(({ method, path }) => method === 'post' && path === '/admin/v1/selections/:selectionId/exports')

    const noHeaders = Object.assign(new Request('https://admin.example.test/api/admin/v1/selections/selection-1/exports', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'ndjson' }),
    }), { payload: {}, routeParams: { selectionId: 'ffffffffffffffffffffffff' } })
    const rejected = await endpoint!.handler(noHeaders as never)
    expect(rejected.status).toBe(400)
    expect(createExport).not.toHaveBeenCalled()

    const badFormat = Object.assign(new Request('https://admin.example.test/api/admin/v1/selections/selection-1/exports', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k', 'x-request-id': 'r' },
      body: JSON.stringify({ format: 'pdf' }),
    }), { payload: {}, routeParams: { selectionId: 'ffffffffffffffffffffffff' } })
    const invalid = await endpoint!.handler(badFormat as never)
    expect(invalid.status).toBe(400)
  })

  test('POST fails closed with 503 when export storage is unconfigured', async () => {
    for (const key of S3_KEYS) delete process.env[key]
    const { exportEndpoints } = await import('../../../src/payload/endpoints/exports')
    const endpoint = exportEndpoints().find(({ method, path }) => method === 'post' && path === '/admin/v1/selections/:selectionId/exports')
    const request = Object.assign(new Request('https://admin.example.test/api/admin/v1/selections/selection-1/exports', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k', 'x-request-id': 'r' },
      body: JSON.stringify({ format: 'ndjson' }),
    }), { payload: {}, routeParams: { selectionId: 'ffffffffffffffffffffffff' } })

    const response = await endpoint!.handler(request as never)
    expect(response.status).toBe(503)
    expect(createExport).not.toHaveBeenCalled()
    expect(retainSelectionForAudit).not.toHaveBeenCalled()
  })

  function exportDocument(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      _id: 'dddddddddddddddddddddddd', selectionId: 'ffffffffffffffffffffffff', actorId: 'admin-1', format: 'ndjson', status: 'running',
      progress: {}, key: null, contentType: null, sha256: null,
      expiresAt: new Date('2026-08-29T00:00:00.000Z'), idempotencyKey: 'k', requestHash: 'h', requestId: 'r',
      payloadJobId: 'job-1', leaseOwner: 'w', leaseExpiresAt: null, fencingToken: 1,
      ...overrides,
    }
  }

  function modelStub(document: Record<string, unknown> | null) {
    return { db: { collections: { 'collection-exports': { findOne: vi.fn(() => ({ lean: async () => document })) } } } }
  }

  test('GET returns progress for queued exports and a short-lived URL only when complete', async () => {
    const { exportEndpoints } = await import('../../../src/payload/endpoints/exports')
    const endpoints = exportEndpoints()
    const getEndpoint = endpoints.find(({ method, path }) => method === 'get' && path === '/admin/v1/exports/:id')
    if (!getEndpoint) throw new Error('GET endpoint missing')

    const queued = Object.assign(new Request('https://admin.example.test/api/admin/v1/exports/export-queued'), {
      payload: modelStub(exportDocument({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', status: 'running', progress: { processed: 100 } })), routeParams: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
    })
    const queuedResponse = await getEndpoint!.handler(queued as never)
    expect(queuedResponse.status).toBe(200)
    const queuedBody = await queuedResponse.json()
    expect(queuedBody.status).toBe('running')
    expect(queuedBody.progress).toEqual({ processed: 100 })
    expect(queuedBody.downloadUrl).toBeUndefined()

    const complete = Object.assign(new Request('https://admin.example.test/api/admin/v1/exports/export-done'), {
      payload: modelStub(exportDocument({
        _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', format: 'csv', status: 'complete', progress: { processed: 3 },
        key: 'selection-1/export-done.csv', contentType: 'text/csv', sha256: 'ab'.repeat(32),
      })),
      routeParams: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
    })
    const completeResponse = await getEndpoint!.handler(complete as never)
    expect(completeResponse.status).toBe(200)
    const completeBody = await completeResponse.json()
    expect(completeBody.status).toBe('complete')
    expect(completeBody.sha256).toBe('ab'.repeat(32))
    expect(completeBody.downloadUrl).toContain('private')
    expect(completeBody.downloadUrl).not.toContain('public-read')
    expect(new Date(completeBody.downloadExpiresAt).getTime()).toBeGreaterThan(Date.now())
    expect(readUrl).toHaveBeenCalledWith(expect.objectContaining({ key: 'selection-1/export-done.csv' }))
  })

  test('GET 404s for another actor and 503s when storage is unconfigured on a complete export', async () => {
    const { exportEndpoints } = await import('../../../src/payload/endpoints/exports')
    const getEndpoint = exportEndpoints().find(({ method, path }) => method === 'get' && path === '/admin/v1/exports/:id')
    if (!getEndpoint) throw new Error('GET endpoint missing')

    const foreign = Object.assign(new Request('https://admin.example.test/api/admin/v1/exports/export-foreign'), {
      payload: modelStub(null), routeParams: { id: 'cccccccccccccccccccccccc' },
    })
    const foreignResponse = await getEndpoint!.handler(foreign as never)
    expect(foreignResponse.status).toBe(404)

    const complete = Object.assign(new Request('https://admin.example.test/api/admin/v1/exports/export-done'), {
      payload: modelStub(exportDocument({
        _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', format: 'csv', status: 'complete',
        key: 'selection-1/export-done.csv', contentType: 'text/csv', sha256: 'ab'.repeat(32),
      })),
      routeParams: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
    })
    for (const key of S3_KEYS) delete process.env[key]
    const unconfigured = await getEndpoint!.handler(complete as never)
    expect(unconfigured.status).toBe(503)
  })
})