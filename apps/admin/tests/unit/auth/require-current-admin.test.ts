import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Payload } from 'payload'
import type { CmsIdentity } from '../../../src/auth/fastapi-authz-client'
import { requireCurrentAdmin } from '../../../src/auth/require-current-admin'

const admin: CmsIdentity = {
  authz_revision: 'revision-1',
  authorized: true,
  email: 'admin@example.test',
  name: 'Admin',
  picture: null,
  role: 'admin',
  user_id: 'user-1',
}

const session = { id: 'session-1', subject: 'user-1' }
const payload = {} as Payload

/** Colaboradores injetados: sem Payload, sem Mongo, sem FastAPI. */
function deps(overrides: Partial<Parameters<typeof requireCurrentAdmin>[1]> = {}) {
  return {
    loadPayload: vi.fn().mockResolvedValue(payload),
    resolveSession: vi.fn().mockResolvedValue(session),
    introspect: vi.fn().mockResolvedValue(admin),
    mirrorUser: vi.fn().mockResolvedValue({ id: 'cms-user-1' }),
    revokeSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('requireCurrentAdmin', () => {
  test('keeps the request alive when the cms-users mirror write loses a race', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Medido em produção: o espelho grava a mesma linha a cada request e a
    // transação do Payload devolve "Write conflict during plan execution and
    // yielding is disabled" — o request autenticado morria em 503.
    const conflict = new Error('Write conflict during plan execution and yielding is disabled')
    const injected = deps({ mirrorUser: vi.fn().mockRejectedValue(conflict) })

    await expect(requireCurrentAdmin(new Headers(), injected)).resolves.toBe(admin)

    expect(injected.mirrorUser).toHaveBeenCalledWith(payload, admin)
    expect(warn).toHaveBeenCalledWith('[withAdmin] cms-users mirror failed', conflict)
  })

  test('still refuses the request when the authorization authority is unreachable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const injected = deps({ introspect: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) })

    await expect(requireCurrentAdmin(new Headers(), injected)).rejects.toMatchObject({
      status: 503,
      code: 'authorization_unavailable',
    })
  })

  test('requires a session cookie', async () => {
    const injected = deps({ resolveSession: vi.fn().mockResolvedValue(null) })

    await expect(requireCurrentAdmin(new Headers(), injected)).rejects.toMatchObject({
      status: 401,
      code: 'authentication_required',
    })
  })

  test('revokes the session when FastAPI downgrades the actor', async () => {
    const injected = deps({ introspect: vi.fn().mockResolvedValue({ ...admin, role: 'curator' }) })

    await expect(requireCurrentAdmin(new Headers(), injected)).rejects.toMatchObject({
      status: 403,
      code: 'authorization_revoked',
    })
    expect(injected.revokeSession).toHaveBeenCalledWith(payload, session.id)
    expect(injected.mirrorUser).not.toHaveBeenCalled()
  })

  test('does not turn a failed revocation into an availability error', async () => {
    const injected = deps({
      introspect: vi.fn().mockResolvedValue({ ...admin, authorized: false }),
      revokeSession: vi.fn().mockRejectedValue(new Error('mongo down')),
    })

    await expect(requireCurrentAdmin(new Headers(), injected)).rejects.toMatchObject({
      status: 403,
      code: 'authorization_revoked',
    })
  })
})
