import { describe, expect, test, vi } from 'vitest'

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

function requestFor(url: string, collections: Record<string, unknown>) {
  return Object.assign(new Request(url), {
    query: Object.fromEntries(new URL(url).searchParams.entries()),
    payload: { db: { collections } },
  })
}

describe('operations admin read models', () => {
  test('recent bulk operations are scoped to the current actor and aggregate children safely', async () => {
    const parentId = '65f000000000000000000001'
    let parentQuery: Record<string, unknown> | null = null
    const operationsCollection = {
      find(query: Record<string, unknown>) {
        parentQuery = query
        return {
          sort: () => ({
            limit: () => ({
              toArray: async () => [{
                _id: parentId,
                actorId: 'admin-1',
                action: 'add',
                mode: 'selection',
                parentOperationId: null,
                createdAt: '2026-09-02T10:00:00.000Z',
                updatedAt: '2026-09-02T10:00:00.000Z',
              }],
            }),
          }),
        }
      },
      aggregate: () => ({
        toArray: async () => [{
          _id: parentId,
          children: [
            { status: 'completed', progress: { processed: 8 }, collectionId: '507f1f77bcf86cd799439011' },
            { status: 'failed', progress: { failed: 1 }, collectionId: '507f1f77bcf86cd799439012' },
          ],
          latestUpdatedAt: '2026-09-02T10:05:00.000Z',
        }],
      }),
    }
    const collectionModel = {
      find: () => ({ lean: async () => [
        { _id: '507f1f77bcf86cd799439011', title: 'Victoria', slug: 'victoria' },
        { _id: '507f1f77bcf86cd799439012', title: 'Vancouver', slug: 'vancouver' },
      ] }),
    }
    const { operationsAdminEndpoints } = await import('../../../src/payload/endpoints/operations-admin')
    const endpoint = operationsAdminEndpoints().find(({ method, path }) => method === 'get' && path === '/admin/v1/operation-history')!

    const response = await endpoint.handler(requestFor(
      'https://admin.example.test/api/admin/v1/operation-history?actor=current',
      {
        'collection-operations': { collection: operationsCollection },
        collections: collectionModel,
      },
    ) as never)

    expect(parentQuery).toMatchObject({ actorId: 'admin-1', mode: 'selection', parentOperationId: null })
    expect(await response.json()).toEqual({
      items: [{
        id: parentId,
        action: 'add',
        status: 'failed',
        parentSummary: { active: 0, completed: 1, failed: 1 },
        progress: { processed: 8, skipped: 0, failed: 1 },
        cancellable: false,
        collections: [
          { id: '507f1f77bcf86cd799439011', title: 'Victoria', slug: 'victoria' },
          { id: '507f1f77bcf86cd799439012', title: 'Vancouver', slug: 'vancouver' },
        ],
        createdAt: '2026-09-02T10:00:00.000Z',
        updatedAt: '2026-09-02T10:05:00.000Z',
      }],
      nextCursor: null,
    })
  })

  test('publish history is scoped to the current actor and exposes an allowlisted shape', async () => {
    let publishQuery: Record<string, unknown> | null = null
    const jobs = {
      find(query: Record<string, unknown>) {
        publishQuery = query
        return {
          sort: () => ({
            limit: () => ({
              lean: async () => [{
                _id: '65f000000000000000000010',
                actorId: 'admin-1',
                collectionId: '507f1f77bcf86cd799439011',
                targetVersion: 3,
                status: 'completed',
                checkpoint: 'promoted',
                selectedCount: 9,
                confirmedUnavailableCount: 1,
                requestHash: 'must-not-leak',
                idempotencyKey: 'must-not-leak',
                createdAt: '2026-09-02T11:00:00.000Z',
                updatedAt: '2026-09-02T11:02:00.000Z',
              }],
            }),
          }),
        }
      },
    }
    const collectionModel = {
      find: () => ({ lean: async () => [{ _id: '507f1f77bcf86cd799439011', title: 'Victoria', slug: 'victoria' }] }),
    }
    const { operationsAdminEndpoints } = await import('../../../src/payload/endpoints/operations-admin')
    const endpoint = operationsAdminEndpoints().find(({ method, path }) => method === 'get' && path === '/admin/v1/publish-jobs')!

    const response = await endpoint.handler(requestFor(
      'https://admin.example.test/api/admin/v1/publish-jobs?actor=current',
      { 'collection-publish-jobs': jobs, collections: collectionModel },
    ) as never)

    expect(publishQuery).toMatchObject({ actorId: 'admin-1' })
    expect(await response.json()).toEqual({
      items: [{
        id: '65f000000000000000000010',
        collection: { id: '507f1f77bcf86cd799439011', title: 'Victoria', slug: 'victoria' },
        targetVersion: 3,
        status: 'completed',
        checkpoint: 'promoted',
        selectedCount: 9,
        confirmedUnavailableCount: 1,
        createdAt: '2026-09-02T11:00:00.000Z',
        updatedAt: '2026-09-02T11:02:00.000Z',
      }],
      nextCursor: null,
    })
  })
})
