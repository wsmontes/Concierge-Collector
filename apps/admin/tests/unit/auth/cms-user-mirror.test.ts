import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { Payload } from 'payload'
import type { CmsIdentity } from '../../../src/auth/fastapi-authz-client'
import { mirrorCmsUser } from '../../../src/auth/cms-strategy'

const identity: CmsIdentity = {
  authz_revision: 'revision-1',
  authorized: true,
  email: 'admin@example.test',
  name: 'Admin',
  picture: null,
  role: 'admin',
  user_id: 'user-1',
}

function mirroredRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cms-user-1',
    fastapiUserId: identity.user_id,
    email: identity.email,
    name: identity.name,
    picture: null,
    role: identity.role,
    authorized: identity.authorized,
    authzRevision: identity.authz_revision,
    lastIntrospectedAt: new Date().toISOString(),
    ...overrides,
  }
}

function fakePayload(row: Record<string, unknown> | null): {
  payload: Payload
  find: Mock
  update: Mock
  create: Mock
} {
  const find = vi.fn().mockResolvedValue({ docs: row ? [row] : [] })
  const update = vi.fn().mockImplementation(async ({ id, data }: { id: string; data: unknown }) => ({ id, ...(data as object) }))
  const create = vi.fn().mockImplementation(async ({ data }: { data: unknown }) => ({ id: 'cms-user-new', ...(data as object) }))
  return { payload: { find, update, create } as unknown as Payload, find, update, create }
}

afterEach(() => { vi.restoreAllMocks() })

describe('mirrorCmsUser', () => {
  test('does not write when the identity is unchanged and the stamp is fresh', async () => {
    const row = mirroredRow()
    const { payload, update, create } = fakePayload(row)

    await expect(mirrorCmsUser(payload, identity)).resolves.toBe(row)

    // O ponto do teste: cada request autenticado gravava esta linha, e
    // requisições concorrentes colidiam na transação do Payload (write conflict).
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  test('refreshes the stamp when it is older than the window', async () => {
    const row = mirroredRow({ lastIntrospectedAt: new Date(Date.now() - 10 * 60_000).toISOString() })
    const { payload, update } = fakePayload(row)

    await mirrorCmsUser(payload, identity)

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toMatchObject({ collection: 'cms-users', id: 'cms-user-1' })
  })

  test.each([
    ['role', { role: 'curator' }],
    ['name', { name: 'Outro Nome' }],
    ['authorized', { authorized: false }],
    ['authzRevision', { authzRevision: 'revision-2' }],
  ])('writes when the mirrored %s changed', async (_field, override) => {
    const { payload, update } = fakePayload(mirroredRow(override))

    await mirrorCmsUser(payload, identity)

    expect(update).toHaveBeenCalledTimes(1)
  })

  test('creates the row on first sight of an identity', async () => {
    const { payload, create, update } = fakePayload(null)

    await expect(mirrorCmsUser(payload, identity)).resolves.toMatchObject({ id: 'cms-user-new' })

    expect(create).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
  })
})
