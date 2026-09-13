import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FastApiClientError } from '@concierge/fastapi-client'
import { ContentRecordAdapter } from '../../../src/fastapi/content-adapter'
import { adminErrorResponse } from '../../../src/http/errors'

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env = {
    ...originalEnv,
    CMS_MONGODB_URL: 'mongodb://localhost:27017',
    CMS_SERVICE_KEY: 'test-cms-service-key',
    FASTAPI_BASE_URL: 'https://api.example.test',
    PAYLOAD_SECRET: 'x'.repeat(32),
    CMS_PUBLIC_SERVER_URL: 'https://admin.example.test',
    CMS_COLLECTOR_ORIGINS: '',
    METRICS_KEY: 'test-metrics-key',
  }
})

afterEach(() => {
  process.env = originalEnv
  vi.restoreAllMocks()
})

/** The adapter with its upstream client replaced by a stub that always fails. */
function failingAdapter(status: number): ContentRecordAdapter {
  const adapter = new ContentRecordAdapter()
  vi.spyOn(adapter as unknown as { client: object }, 'client', 'get').mockReturnValue({
    curationRecord: vi.fn().mockRejectedValue(new FastApiClientError(status, '{"detail":"upstream"}')),
    entityRecord: vi.fn().mockRejectedValue(new FastApiClientError(status, '{"detail":"upstream"}')),
    patchCurationRecord: vi.fn().mockRejectedValue(new FastApiClientError(status, '{"detail":"upstream"}')),
  })
  return adapter
}

async function failureResponse(adapter: ContentRecordAdapter, call: () => Promise<unknown>): Promise<Response> {
  try {
    await call()
  } catch (error) {
    return adminErrorResponse(error)
  }
  throw new Error('expected the adapter to reject')
}

/**
 * The upstream status must survive the BFF boundary.
 *
 * `adminErrorResponse` validates each code against the status table and degrades
 * an inconsistent pair to 503, so a wrong code silently turns "someone else
 * edited this" into "the service is down" — and the editor retries a save that
 * can never succeed.
 */
describe('ContentRecordAdapter error mapping', () => {
  const cases: { upstream: number; expectedStatus: number; expectedCode: string }[] = [
    { upstream: 400, expectedStatus: 400, expectedCode: 'invalid_request' },
    { upstream: 401, expectedStatus: 403, expectedCode: 'authorization_revoked' },
    { upstream: 403, expectedStatus: 403, expectedCode: 'authorization_revoked' },
    { upstream: 404, expectedStatus: 404, expectedCode: 'not_found' },
    { upstream: 409, expectedStatus: 409, expectedCode: 'conflict' },
    { upstream: 412, expectedStatus: 412, expectedCode: 'precondition_failed' },
  ]

  for (const { upstream, expectedStatus, expectedCode } of cases) {
    test(`maps an upstream ${upstream} to ${expectedStatus} ${expectedCode}`, async () => {
      const adapter = failingAdapter(upstream)
      const response = await failureResponse(adapter, () => adapter.curation('cur_1'))

      expect(response.status).toBe(expectedStatus)
      expect(await response.json()).toEqual({ error: { code: expectedCode } })
    })
  }

  test('treats an unmapped upstream failure as an outage, never as a silent success', async () => {
    const adapter = failingAdapter(500)
    const response = await failureResponse(adapter, () => adapter.entity('ent_1'))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: 'authorization_unavailable' } })
  })

  test('passes the version fence and the live actor to the write', async () => {
    const adapter = new ContentRecordAdapter()
    const patchCurationRecord = vi.fn().mockResolvedValue({ id: 'cur_1', kind: 'curation', record: {} })
    vi.spyOn(adapter as unknown as { client: object }, 'client', 'get').mockReturnValue({ patchCurationRecord })

    await adapter.patchCuration('cur_1', { 'notes.private': 'Reviewed' }, 4, 'admin@example.test')

    expect(patchCurationRecord).toHaveBeenCalledWith('cur_1', { 'notes.private': 'Reviewed' }, 4, 'admin@example.test')
  })
})
