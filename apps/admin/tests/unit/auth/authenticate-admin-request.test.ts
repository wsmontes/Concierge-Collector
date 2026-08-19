import { afterEach, describe, expect, test, vi } from 'vitest'
import { FastApiAuthzError, type CmsIdentity } from '../../../src/auth/fastapi-authz-client'
import { authenticateAdminRequest } from '../../../src/auth/authenticate-admin-request'

const admin: CmsIdentity = {
  authz_revision: 'r1', authorized: true, email: 'admin@example.test', name: 'Admin', picture: null, role: 'admin', user_id: 'admin-1',
}
const original = { ...process.env }

function env(): void {
  process.env = {
    ...original,
    CMS_MONGODB_URL: 'mongodb://localhost:27017', CMS_SERVICE_KEY: 'service-key', FASTAPI_BASE_URL: 'https://api.example.test',
    PAYLOAD_SECRET: 'x'.repeat(32), CMS_PUBLIC_SERVER_URL: 'https://admin.example.test', CMS_COLLECTOR_ORIGINS: 'https://collector.example.test',
  }
}

afterEach(() => { process.env = { ...original }; vi.restoreAllMocks() })

describe('authenticateAdminRequest', () => {
  test('uses a revalidated Bearer only for the exact Collector origin and one Curation', async () => {
    env()
    const introspectCollectorBearer = vi.fn().mockResolvedValue(admin)
    const requireCurrentAdmin = vi.fn()
    await expect(authenticateAdminRequest(
      new Request('https://admin.example.test/api/admin/v1/x', { headers: { origin: 'https://collector.example.test', authorization: 'Bearer live-token' } }),
      { allowCollectorBearer: true, explicitCurationIds: ['c1'] },
      { introspectCollectorBearer, requireCurrentAdmin },
    )).resolves.toBe(admin)
    expect(introspectCollectorBearer).toHaveBeenCalledWith('Bearer live-token', expect.any(String))
    expect(requireCurrentAdmin).not.toHaveBeenCalled()
  })

  test.each([
    [{ allowCollectorBearer: true, explicitCurationIds: [] }],
    [{ allowCollectorBearer: false, explicitCurationIds: ['c1'] }],
  ])('rejects a Collector request outside its explicit scope', async (input) => {
    env()
    await expect(authenticateAdminRequest(
      new Request('https://admin.example.test/api/admin/v1/x', { headers: { origin: 'https://collector.example.test', authorization: 'Bearer live-token' } }),
      input,
      { introspectCollectorBearer: vi.fn(), requireCurrentAdmin: vi.fn() },
    )).rejects.toMatchObject({ status: 403 })
  })

  test('keeps admin-origin requests on the host-only CMS session path', async () => {
    env()
    const requireCurrentAdmin = vi.fn().mockResolvedValue(admin)
    await expect(authenticateAdminRequest(
      new Request('https://admin.example.test/api/admin/v1/x', { headers: { origin: 'https://admin.example.test' } }),
      {}, { requireCurrentAdmin, introspectCollectorBearer: vi.fn() },
    )).resolves.toBe(admin)
    expect(requireCurrentAdmin).toHaveBeenCalledOnce()
  })

  test.each([
    [401, 401, 'authentication_required'],
    [403, 403, 'authorization_denied'],
    [503, 503, 'authorization_unavailable'],
  ])('preserves safe Collector bridge failures (%s)', async (upstreamStatus, expectedStatus, code) => {
    env()
    await expect(authenticateAdminRequest(
      new Request('https://admin.example.test/api/admin/v1/x', { headers: { origin: 'https://collector.example.test', authorization: 'Bearer stale-token' } }),
      { allowCollectorBearer: true, explicitCurationIds: ['c1'] },
      { introspectCollectorBearer: vi.fn().mockRejectedValue(new FastApiAuthzError(upstreamStatus)), requireCurrentAdmin: vi.fn() },
    )).rejects.toMatchObject({ status: expectedStatus, code })
  })
})
