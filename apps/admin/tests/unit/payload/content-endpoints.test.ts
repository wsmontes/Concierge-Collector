import { describe, expect, test, vi } from 'vitest'
import { AdminHttpError } from '../../../src/http/errors'

const actor = {
  authz_revision: 'revision-1', authorized: true, email: 'admin@example.test', name: 'Admin', picture: null,
  role: 'admin' as const, user_id: 'admin-1',
}

vi.mock('../../../src/http/with-admin', () => ({
  withAdmin: (handler: (request: Request, currentActor: typeof actor) => Promise<Response>) =>
    (request: Request) => handler(request, actor),
}))

function loader(overrides: Record<string, unknown> = {}) {
  return {
    curation: vi.fn().mockResolvedValue({ kind: 'curation', id: 'cur_1', record: { version: 4 } }),
    entity: vi.fn().mockResolvedValue({ kind: 'entity', id: 'ent_1', record: {} }),
    patchCuration: vi.fn().mockResolvedValue({ kind: 'curation', id: 'cur_1', record: { version: 5 } }),
    ...overrides,
  }
}

async function endpointFor(method: string, path: string, dependencies = loader()) {
  const { contentEndpoints } = await import('../../../src/payload/endpoints/content')
  const endpoint = contentEndpoints(() => dependencies)
    .find((candidate) => candidate.method === method && candidate.path === path)
  if (!endpoint) throw new Error(`missing endpoint ${method} ${path}`)
  return { endpoint, dependencies }
}

/** Payload fills `routeParams` while routing; a bare `Request` has to carry it explicitly. */
function recordRequest(id: string, init: RequestInit = {}): Request {
  return Object.assign(
    new Request(`https://admin.example.test/api/admin/v1/curations/${id}`, init),
    { routeParams: { id } },
  )
}

function patchRequest(body: unknown, id = 'cur_1', headers: Record<string, string> = {}): Request {
  return recordRequest(id, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('content record endpoints', () => {
  test('reads a whole record by id', async () => {
    const { endpoint, dependencies } = await endpointFor('get', '/admin/v1/curations/:id')

    const response = await endpoint.handler(recordRequest('cur_1') as never)

    expect(response.status).toBe(200)
    expect(dependencies.curation).toHaveBeenCalledWith('cur_1')
  })

  test('writes dotted fields with the actor identity and the loaded version', async () => {
    const { endpoint, dependencies } = await endpointFor('patch', '/admin/v1/curations/:id')

    const response = await endpoint.handler(
      patchRequest({ fields: { 'notes.private': 'Reviewed' } }, 'cur_1', { 'If-Match': '4' }) as never,
    )

    expect(response.status).toBe(200)
    // The browser never supplies the actor: it comes from the live FastAPI identity.
    expect(dependencies.patchCuration).toHaveBeenCalledWith(
      'cur_1',
      { 'notes.private': 'Reviewed' },
      4,
      'admin@example.test',
    )
  })

  test('refuses an unfenced write before touching the service', async () => {
    const { endpoint, dependencies } = await endpointFor('patch', '/admin/v1/curations/:id')

    const response = await endpoint.handler(patchRequest({ fields: { 'notes.private': 'x' } }) as never)

    expect(response.status).toBe(400)
    expect(dependencies.patchCuration).not.toHaveBeenCalled()
  })

  test('refuses an empty or malformed field payload', async () => {
    const { endpoint, dependencies } = await endpointFor('patch', '/admin/v1/curations/:id')

    const empty = await endpoint.handler(patchRequest({ fields: {} }, 'cur_1', { 'If-Match': '4' }) as never)
    const wrongShape = await endpoint.handler(
      patchRequest({ fields: ['notes.private'] }, 'cur_1', { 'If-Match': '4' }) as never,
    )

    expect(empty.status).toBe(400)
    expect(wrongShape.status).toBe(400)
    expect(dependencies.patchCuration).not.toHaveBeenCalled()
  })

  test('surfaces an upstream conflict instead of a successful save', async () => {
    const { endpoint } = await endpointFor('patch', '/admin/v1/curations/:id', loader({
      patchCuration: vi.fn().mockRejectedValue(new AdminHttpError(409, 'conflict')),
    }))

    const response = await endpoint.handler(
      patchRequest({ fields: { 'notes.private': 'x' } }, 'cur_1', { 'If-Match': '4' }) as never,
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: 'conflict' } })
  })

  test('rejects a traversal-shaped id without calling the service', async () => {
    const { endpoint, dependencies } = await endpointFor('get', '/admin/v1/entities/:id')

    const response = await endpoint.handler(recordRequest('../../admin') as never)

    expect(response.status).toBe(404)
    expect(dependencies.entity).not.toHaveBeenCalled()
  })
})
