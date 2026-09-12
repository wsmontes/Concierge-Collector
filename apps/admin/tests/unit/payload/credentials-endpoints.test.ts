import { beforeEach, describe, expect, test, vi } from 'vitest'

const actor = {
  authz_revision: 'revision-1', authorized: true, email: 'admin@example.test', name: 'Admin', picture: null,
  role: 'admin' as const, user_id: 'admin-1',
}

const rotateCredential = vi.fn()

vi.mock('../../../src/http/with-admin', async () => {
  // A factory do vi.mock é hoisted acima dos imports, então o formatter real
  // precisa ser resolvido aqui dentro (importActual mantém a implementação de
  // adminErrorResponse — é ELA que define o contrato HTTP 409 + code).
  // Sem isso o mock deixava o AdminHttpError escapar como rejeição e o teste
  // não conseguia observar o status que o withAdmin real produz.
  const { adminErrorResponse } = await vi.importActual<typeof import('../../../src/http/errors')>('../../../src/http/errors')
  return {
    withAdmin: (handler: (request: Request, currentActor: typeof actor) => Promise<Response>) =>
      async (request: Request) => {
        try {
          return await handler(request, actor)
        } catch (error) {
          return adminErrorResponse(error)
        }
      },
  }
})

vi.mock('../../../src/applications/credentials', () => ({
  issueCredential: vi.fn(),
  revokeCredential: vi.fn(),
  rotateCredential,
}))

vi.mock('../../../src/applications/repository', () => ({
  PayloadCredentialRepository: class {},
}))

function requestFor(model: Record<string, unknown>) {
  return Object.assign(new Request('https://admin.example.test/api/admin/v1/credentials/65f000000000000000000001/rotate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'shared-key',
      'x-request-id': 'request-1',
    },
    body: JSON.stringify({ overlapUntil: '2026-09-03T12:00:00.000Z' }),
  }), {
    routeParams: { id: '65f000000000000000000001' },
    payload: { db: { collections: { 'consumer-credentials': model } } },
  })
}

/**
 * Dublê da collection que responde por QUERY, não por posição.
 *
 * O handler real faz duas buscas distintas: uma pelo `_id` (para descobrir a
 * Application dona) e outra por `{applicationId, issueIdempotencyKey}` (para
 * detectar replay da idempotência). Um dublê que devolvesse o mesmo valor para
 * as duas não representaria o contrato; por isso `byId` e `byIdempotencyKey`
 * são explícitos.
 */
function credentialModel({ byId, byIdempotencyKey }: { byId: unknown; byIdempotencyKey: unknown }) {
  return {
    findOne(query: Record<string, unknown>) {
      const value = '_id' in query ? byId : byIdempotencyKey
      return { lean: async () => value }
    },
  }
}

const SOURCE_CREDENTIAL = { _id: '65f000000000000000000001', applicationId: 'app-a' }

describe('credential endpoints', () => {
  beforeEach(() => {
    rotateCredential.mockReset().mockResolvedValue({
      credential: { id: '65f000000000000000000099', applicationId: 'app-a', prefix: 'abc123' },
      secretOnce: 'cck_once',
    })
  })

  test('rotate scopes idempotency replay detection to the source Application', async () => {
    const queries: Record<string, unknown>[] = []
    const model = {
      findOne(query: Record<string, unknown>) {
        queries.push(query)
        // Fonte encontrada pelo _id; nenhuma Application tem o par
        // (applicationId, issueIdempotencyKey) desta rotação.
        const value = '_id' in query ? SOURCE_CREDENTIAL : null
        return { lean: async () => value }
      },
    }
    const { credentialEndpoints } = await import('../../../src/payload/endpoints/credentials')
    const endpoint = credentialEndpoints().find(({ method, path }) => method === 'post' && path === '/admin/v1/credentials/:id/rotate')!

    const response = await endpoint.handler(requestFor(model) as never)

    expect(response.status).toBe(201)
    expect(queries).toEqual([
      { _id: '65f000000000000000000001' },
      { applicationId: 'app-a', issueIdempotencyKey: 'shared-key' },
    ])
    expect(rotateCredential).toHaveBeenCalledTimes(1)
  })

  test('rotate still blocks a consumed idempotency key inside the same Application', async () => {
    const model = credentialModel({
      byId: SOURCE_CREDENTIAL,
      byIdempotencyKey: { _id: 'already-issued', applicationId: 'app-a', issueIdempotencyKey: 'shared-key' },
    })
    const { credentialEndpoints } = await import('../../../src/payload/endpoints/credentials')
    const endpoint = credentialEndpoints().find(({ method, path }) => method === 'post' && path === '/admin/v1/credentials/:id/rotate')!

    const response = await endpoint.handler(requestFor(model) as never)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: 'unavailable_confirmation_required' } })
    expect(rotateCredential).not.toHaveBeenCalled()
  })
})
