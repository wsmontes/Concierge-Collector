import { expect, test, vi } from 'vitest'

const actor = {
  authz_revision: 'revision-1',
  authorized: true,
  email: 'admin@example.test',
  name: 'Admin',
  picture: null,
  role: 'admin' as const,
  user_id: 'admin-1',
}

vi.mock('../../../src/http/with-admin', () => ({
  withAdmin: (handler: (request: Request, currentActor: typeof actor) => Promise<Response>) =>
    async (request: Request) => handler(request, actor),
}))

test('publish preview returns the live availability and delta snapshot for the current admin', async () => {
  const { publishingEndpoints } = await import('../../../src/payload/endpoints/publishing')
  const preview = vi.fn().mockResolvedValue({
    currentPublishedVersion: 2,
    nextVersion: 3,
    draftRevision: 7,
    revision: 12,
    selectedCount: 9,
    availableCount: 8,
    unavailableCount: 1,
    addCount: 2,
    removeCount: 1,
  })
  const endpoint = publishingEndpoints({ preview })
    .find(({ method, path }) => method === 'get' && path === '/admin/v1/collections/:id/publish-preview')
  const request = Object.assign(new Request(
    'https://admin.example.test/api/admin/v1/collections/507f1f77bcf86cd799439011/publish-preview',
  ), {
    routeParams: { id: '507f1f77bcf86cd799439011' },
    payload: {},
  })

  const response = await endpoint!.handler(request as never)

  expect(response.status).toBe(200)
  expect(preview).toHaveBeenCalledWith(
    {},
    { collectionId: '507f1f77bcf86cd799439011', actorId: 'admin-1' },
  )
  expect(await response.json()).toEqual({
    currentPublishedVersion: 2,
    nextVersion: 3,
    draftRevision: 7,
    revision: 12,
    selectedCount: 9,
    availableCount: 8,
    unavailableCount: 1,
    addCount: 2,
    removeCount: 1,
  })
})
