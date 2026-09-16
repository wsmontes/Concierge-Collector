import { afterEach, describe, expect, test, vi } from 'vitest'
import type { CmsIdentity } from '../../../src/auth/fastapi-authz-client'
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

function wrapper(handler: Parameters<typeof withAdmin>[0]) {
  return withAdmin(handler, {
    requireCurrentAdmin: vi.fn().mockResolvedValue(admin),
    assertUnsafeCmsSessionOrigin: vi.fn(),
  })
}

afterEach(() => { vi.restoreAllMocks() })

describe('withAdmin — política de cache', () => {
  test('resposta sem declaração própria sai como private, no-store', async () => {
    const response = await wrapper(async () => Response.json({ items: [] }))(new Request('http://admin.test/api/admin/v1/x'))

    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  test('a frescura declarada pelo handler é preservada quando é private', async () => {
    // O proxy de bytes de mídia repassa o `private, max-age=…` do FastAPI. Forçar
    // no-store aqui re-baixava TODA thumbnail a cada visita — e cada uma dessas
    // visitas re-executa o pipeline de fetch+reencode no upstream.
    const response = await wrapper(async () => new Response('bytes', {
      headers: { 'Cache-Control': 'private, max-age=300' },
    }))(new Request('http://admin.test/api/admin/v1/records/entities/e1/image'))

    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300')
  })

  test.each([
    'public, max-age=3600',
    'max-age=3600',
    's-maxage=600',
  ])('uma política SEM private é sobrescrita (%s)', async (declarado) => {
    // O invariante de segurança: resposta autenticada nunca é compartilhável —
    // "private" é a linha, e um handler não pode cruzá-la por engano.
    const response = await wrapper(async () => new Response('corpo', {
      headers: { 'Cache-Control': declarado },
    }))(new Request('http://admin.test/api/admin/v1/x'))

    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  test('falha nunca é armazenável, mesmo com o handler declarando frescura', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await wrapper(async () => {
      throw new Error('boom')
    })(new Request('http://admin.test/api/admin/v1/x'))

    // Um erro inesperado é `service_unavailable` no contrato do Admin (503),
    // não um 500 opaco: a fronteira fora do ar é a leitura operacional correta.
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
