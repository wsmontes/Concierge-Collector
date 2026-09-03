import { beforeEach, describe, expect, test, vi } from 'vitest'

const actor = {
  authz_revision: 'revision-1', authorized: true, email: 'admin@example.test', name: 'Admin', picture: null,
  role: 'admin' as const, user_id: 'admin-1',
}

const createSelection = vi.fn()

vi.mock('../../../src/http/with-admin', () => ({
  withAdmin: (handler: (request: Request, currentActor: typeof actor) => Promise<Response>) =>
    (request: Request) => handler(request, actor),
}))

vi.mock('../../../src/selections/materialize-selection', () => ({
  asRecord: (value: unknown) => value,
  createSelection,
}))

describe('Selection endpoints', () => {
  beforeEach(() => { createSelection.mockReset() })

  test('creates an all-matching intent with the server-derived actor and hides worker internals', async () => {
    createSelection.mockResolvedValueOnce({
      id: 'selection-1', mode: 'all_matching', status: 'queued', candidateCount: 0, capturedCount: 0,
      skippedCount: 0, manifestHash: null, expiresAt: new Date('2026-08-22T00:00:00.000Z'), payloadJobId: 'job-1',
    })
    const { selectionEndpoints } = await import('../../../src/payload/endpoints/selections')
    const endpoint = selectionEndpoints().find(({ method, path }) => method === 'post' && path === '/admin/v1/selections')
    const request = Object.assign(new Request('https://admin.example.test/api/admin/v1/selections', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'selection-key', 'x-request-id': 'request-1' },
      body: JSON.stringify({ mode: 'all_matching', filters: { q: ' Sushi ', status: ['active', 'active'] } }),
    }), { payload: {} })

    const response = await endpoint!.handler(request as never)
    const result = await response.json() as Record<string, unknown>

    expect(response.status).toBe(202)
    expect(result).not.toHaveProperty('payloadJobId')
    expect(createSelection).toHaveBeenCalledWith({}, {
      actorId: 'admin-1', idempotencyKey: 'selection-key', requestId: 'request-1', mode: 'all_matching',
      curationIds: undefined, excludedIds: undefined, filters: { q: 'sushi', status: ['active'] },
    })
  })

  test('rejects a mixed selection body before creating a manifest', async () => {
    const { selectionEndpoints } = await import('../../../src/payload/endpoints/selections')
    const endpoint = selectionEndpoints().find(({ method, path }) => method === 'post' && path === '/admin/v1/selections')
    const request = Object.assign(new Request('https://admin.example.test/api/admin/v1/selections', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'selection-key', 'x-request-id': 'request-1' },
      body: JSON.stringify({ mode: 'explicit', curation_ids: ['c1'], unexpected: true }),
    }), { payload: {} })

    const response = await endpoint!.handler(request as never)

    expect(response.status).toBe(400)
    expect(createSelection).not.toHaveBeenCalled()
  })
})