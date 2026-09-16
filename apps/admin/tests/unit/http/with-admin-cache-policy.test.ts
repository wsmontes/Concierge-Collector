import { describe, expect, test, vi } from 'vitest'
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

describe('withAdmin cache policy', () => {
  test('marks successful admin responses private and no-store', async () => {
    const guarded = withAdmin(
      vi.fn(() => Response.json({ ok: true })),
      {
        assertUnsafeCmsSessionOrigin: vi.fn(),
        requireCurrentAdmin: vi.fn().mockResolvedValue(admin),
      },
    )

    const response = await guarded(new Request('https://admin.example.test/api/admin/v1/collections'))

    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('marks admin error responses private and no-store', async () => {
    const guarded = withAdmin(
      vi.fn(),
      {
        assertUnsafeCmsSessionOrigin: vi.fn(),
        requireCurrentAdmin: vi.fn().mockRejectedValue(new AdminHttpError(403, 'authorization_revoked')),
      },
    )

    const response = await guarded(new Request('https://admin.example.test/api/admin/v1/collections'))

    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  /**
   * A handler MAY declare its own freshness — but only INSIDE `private`. That is
   * the whole exemption: the media byte proxy forwards FastAPI's
   * `private, max-age=…`, and forcing `no-store` there was measured to
   * re-download every thumbnail on every visit (each one re-running the upstream
   * fetch-and-reencode pipeline). Anything that is not `private` stays clobbered,
   * so a handler — or an upstream response it forwards — can never let an
   * authenticated admin response into a shared cache.
   */
  test('preserves a handler-declared private freshness policy', async () => {
    const guarded = withAdmin(
      vi.fn(() => new Response('bytes', { headers: { 'Cache-Control': 'private, max-age=300' } })),
      {
        assertUnsafeCmsSessionOrigin: vi.fn(),
        requireCurrentAdmin: vi.fn().mockResolvedValue(admin),
      },
    )

    const response = await guarded(new Request('https://admin.example.test/api/admin/v1/records/entities/e1/image'))

    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
  })

  test.each([
    'public, max-age=3600',
    'max-age=3600',
    's-maxage=600',
    'public, max-age=3600, s-maxage=600',
  ])('overwrites a policy that is not private (%s)', async (declared) => {
    const guarded = withAdmin(
      vi.fn(() => new Response('body', { headers: { 'Cache-Control': declared } })),
      {
        assertUnsafeCmsSessionOrigin: vi.fn(),
        requireCurrentAdmin: vi.fn().mockResolvedValue(admin),
      },
    )

    const response = await guarded(new Request('https://admin.example.test/api/admin/v1/x'))

    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test.each([
    'private, public, max-age=600',
    'private, s-maxage=600',
  ])('overwrites a contradictory or shared-cache directive mixed with private (%s)', async (declared) => {
    // `s-maxage` só existe para cache COMPARTILHADO e `public` contradiz `private`:
    // nenhum dos dois pode pegar carona na exceção, senão uma resposta autenticada
    // entra num cache de proxy por causa de um valor mal formado do upstream.
    const guarded = withAdmin(
      vi.fn(() => new Response('body', { headers: { 'Cache-Control': declared } })),
      {
        assertUnsafeCmsSessionOrigin: vi.fn(),
        requireCurrentAdmin: vi.fn().mockResolvedValue(admin),
      },
    )

    const response = await guarded(new Request('https://admin.example.test/api/admin/v1/x'))

    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})
