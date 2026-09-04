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
})
