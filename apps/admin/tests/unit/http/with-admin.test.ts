import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CmsIdentity } from '../../../src/auth/fastapi-authz-client'
import { AdminHttpError } from '../../../src/http/errors'
import { withAdmin } from '../../../src/http/with-admin'

const admin: CmsIdentity = {
  authz_revision: 'revision-1',
  authorized: true,
  email: 'admin@example.test',
  name: 'Admin',
  picture: null,
  role: 'admin',
  user_id: 'user-1',
}

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env = {
    ...originalEnv,
    CMS_MONGODB_URL: 'mongodb://localhost:27017',
    CMS_SERVICE_KEY: 'test-cms-service-key',
    FASTAPI_BASE_URL: 'https://api.example.test',
    PAYLOAD_SECRET: 'x'.repeat(32),
    CMS_PUBLIC_SERVER_URL: 'https://admin.example.test',
  }
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('withAdmin', () => {
  test('does not call the handler when live introspection revokes the admin', async () => {
    const handler = vi.fn()
    const guarded = withAdmin(handler, {
      requireCurrentAdmin: vi.fn().mockRejectedValue(new AdminHttpError(403, 'authorization_revoked')),
    })

    const response = await guarded(new Request('https://admin.example.test/api/admin/v1/collections'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: { code: 'authorization_revoked' } })
    expect(handler).not.toHaveBeenCalled()
  })

  test('passes the current introspected identity as the authoritative actor', async () => {
    const handler = vi.fn(async (request: Request & { actor: CmsIdentity }, actor: CmsIdentity) => {
      expect(request.actor).toBe(admin)
      return Response.json({ actor })
    })
    const guarded = withAdmin(handler, { requireCurrentAdmin: vi.fn().mockResolvedValue(admin) })
    const request = Object.assign(
      new Request('https://admin.example.test/api/admin/v1/collections'),
      { actor: { ...admin, user_id: 'untrusted-client-value' } },
    )

    const response = await guarded(request)

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledWith(expect.any(Request), admin)
    await expect(response.json()).resolves.toEqual({ actor: admin })
  })

  test.each([
    [401, 'authentication_required'],
    [403, 'authorization_revoked'],
    [412, 'revision_conflict'],
    [412, 'precondition_failed'],
    [423, 'draft_locked'],
    [503, 'authorization_unavailable'],
  ])('maps known admin failure %i to a stable error body', async (status, code) => {
    const guarded = withAdmin(vi.fn(), {
      requireCurrentAdmin: vi.fn().mockRejectedValue(new AdminHttpError(status as 401 | 403 | 409 | 412 | 423 | 503, code)),
    })

    const response = await guarded(new Request('https://admin.example.test/api/admin/v1/collections'))

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ error: { code } })
  })

  test('does not expose unexpected failures and reports them as unavailable', async () => {
    const guarded = withAdmin(vi.fn(), {
      requireCurrentAdmin: vi.fn().mockRejectedValue(new Error('internal connection details')),
    })

    const response = await guarded(new Request('https://admin.example.test/api/admin/v1/collections'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: { code: 'service_unavailable' } })
  })

  test('does not trust a structurally forged admin error', async () => {
    const guarded = withAdmin(vi.fn(), {
      requireCurrentAdmin: vi.fn().mockRejectedValue({ status: 403, code: 'authorization_revoked' }),
    })

    const response = await guarded(new Request('https://admin.example.test/api/admin/v1/collections'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: { code: 'service_unavailable' } })
  })

  test.each([
    ['a missing Origin', undefined],
    ['an evil Origin', 'https://evil.example.test'],
    ['a sibling Origin', 'https://collector.example.test'],
  ])('rejects an unsafe cms_session request with %s before introspection', async (_label, origin) => {
    const requireCurrentAdmin = vi.fn().mockResolvedValue(admin)
    const guarded = withAdmin(vi.fn(), { requireCurrentAdmin })
    const headers = new Headers({ cookie: 'cms_session=session-token' })
    if (origin) headers.set('Origin', origin)

    const response = await guarded(new Request('https://admin.example.test/api/admin/v1/collections', {
      headers,
      method: 'POST',
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: { code: 'csrf_origin_invalid' } })
    expect(requireCurrentAdmin).not.toHaveBeenCalled()
  })

  test('allows an unsafe cms_session request from the configured Admin origin', async () => {
    const requireCurrentAdmin = vi.fn().mockResolvedValue(admin)
    const handler = vi.fn(() => Response.json({ ok: true }))
    const guarded = withAdmin(handler, { requireCurrentAdmin })

    const response = await guarded(new Request('https://admin.example.test/api/admin/v1/collections', {
      headers: {
        cookie: 'cms_session=session-token',
        origin: 'https://admin.example.test',
      },
      method: 'POST',
    }))

    expect(response.status).toBe(200)
    expect(requireCurrentAdmin).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledOnce()
  })

  test('does not impose cookie-origin rules on a future bearer request', async () => {
    const requireCurrentAdmin = vi.fn().mockResolvedValue(admin)
    const handler = vi.fn(() => Response.json({ ok: true }))
    const guarded = withAdmin(handler, { requireCurrentAdmin })

    const response = await guarded(new Request('https://admin.example.test/api/admin/v1/collections', {
      headers: { authorization: 'Bearer future-api-token' },
      method: 'POST',
    }))

    expect(response.status).toBe(200)
    expect(requireCurrentAdmin).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledOnce()
  })
})
