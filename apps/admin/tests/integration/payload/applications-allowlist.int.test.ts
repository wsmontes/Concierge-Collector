import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

integrationSuite('consumer application collection allowlist', () => {
  let service: import('../../../src/applications/service').ConsumerApplicationService
  let applications: import('mongoose').Model<Record<string, unknown>>
  let collections: import('mongoose').Model<Record<string, unknown>>
  let auditEvents: import('mongoose').Model<Record<string, unknown>>
  let connection: import('mongoose').Connection

  async function seedCollection(input: {
    lifecycle: 'draft' | 'published' | 'archived'
    currentPublishedVersion?: number | null
  }): Promise<string> {
    const id = new Types.ObjectId().toHexString()
    const publishedVersion = input.currentPublishedVersion ?? null
    await collections.create({
      _id: id,
      slug: `allowlist-${id}`,
      title: `Allowlist ${id}`,
      lifecycle: input.lifecycle,
      ...(publishedVersion === null ? {} : { currentPublishedVersion: publishedVersion }),
      ...(publishedVersion === null ? {} : { draftBaseVersion: publishedVersion }),
      draftEpoch: `epoch-${id}`,
      draftRevision: 0,
      publishFencingToken: 0,
      operationSequenceCounter: 0,
      draftState: 'clean',
      publishedSelectedCount: 0,
      draftSelectedCount: 0,
      revision: 1,
      everPublished: input.lifecycle !== 'draft',
    })
    return id
  }

  async function createApplication(ids: string[], key: string) {
    return service.create(
      {
        name: `allowlist-${key}`,
        owner: 'integration',
        allowedCollectionIds: ids,
        defaultRequestsPerMinute: 60,
      },
      { actorId: 'admin-1', idempotencyKey: `create-${key}`, requestId: `request-${key}` },
    ) as Promise<{ id: string; revision: number; allowedCollectionIds: string[] }>
  }

  beforeAll(async () => {
    if (!hasTestMongo) return
    const [{ getPayload }, { default: config }, serviceModule] = await Promise.all([
      import('payload'),
      import('../../../payload.config'),
      import('../../../src/applications/service'),
    ])
    const payload = await getPayload({ config })
    service = new serviceModule.ConsumerApplicationService(payload)
    applications = payload.db.collections['consumer-applications'] as unknown as import('mongoose').Model<Record<string, unknown>>
    collections = payload.db.collections.collections as unknown as import('mongoose').Model<Record<string, unknown>>
    auditEvents = payload.db.collections['audit-events'] as unknown as import('mongoose').Model<Record<string, unknown>>
    connection = payload.db.connection
  })

  afterEach(async () => {
    if (!hasTestMongo) return
    await Promise.all([
      applications.deleteMany({}),
      collections.deleteMany({}),
      auditEvents.deleteMany({}),
    ])
  })

  afterAll(async () => {
    if (!hasTestMongo) return
    await connection?.close()
  })

  test.each([
    ['missing', async () => new Types.ObjectId().toHexString()],
    ['draft', async () => seedCollection({ lifecycle: 'draft' })],
    ['archived', async () => seedCollection({ lifecycle: 'archived', currentPublishedVersion: 1 })],
    ['published without version', async () => seedCollection({ lifecycle: 'published' })],
  ])('create rejects a %s Collection grant', async (_label, makeId) => {
    const collectionId = await makeId()
    await expect(createApplication([collectionId], `reject-${_label}`)).rejects.toMatchObject({
      status: 400,
      code: 'collection_not_grantable',
    })
    expect(await applications.countDocuments({})).toBe(0)
  })

  test('create accepts only a real published Collection with a published version', async () => {
    const collectionId = await seedCollection({ lifecycle: 'published', currentPublishedVersion: 3 })
    const application = await createApplication([collectionId], 'published')
    expect(application.allowedCollectionIds).toEqual([collectionId])
  })

  test('patch validates only newly added Collection ids', async () => {
    const historicalId = await seedCollection({ lifecycle: 'published', currentPublishedVersion: 1 })
    const addedId = await seedCollection({ lifecycle: 'published', currentPublishedVersion: 2 })
    const application = await createApplication([historicalId], 'patch-new')

    await collections.updateOne({ _id: historicalId }, { $set: { lifecycle: 'archived' } })

    const patched = await service.patch(
      application.id,
      application.revision,
      { allowedCollectionIds: [historicalId, addedId] },
      { actorId: 'admin-1', idempotencyKey: 'patch-new-key', requestId: 'patch-new-request' },
    ) as { revision: number; allowedCollectionIds: string[] }

    expect(patched.allowedCollectionIds).toEqual([historicalId, addedId])
  })

  test('historical archived grants may remain and can always be removed', async () => {
    const historicalId = await seedCollection({ lifecycle: 'published', currentPublishedVersion: 1 })
    const application = await createApplication([historicalId], 'historical')
    await collections.updateOne({ _id: historicalId }, { $set: { lifecycle: 'archived' } })

    const retained = await service.patch(
      application.id,
      application.revision,
      { allowedCollectionIds: [historicalId] },
      { actorId: 'admin-1', idempotencyKey: 'retain-key', requestId: 'retain-request' },
    ) as { revision: number; allowedCollectionIds: string[] }
    expect(retained.allowedCollectionIds).toEqual([historicalId])

    const removed = await service.patch(
      application.id,
      retained.revision,
      { allowedCollectionIds: [] },
      { actorId: 'admin-1', idempotencyKey: 'remove-key', requestId: 'remove-request' },
    ) as { allowedCollectionIds: string[] }
    expect(removed.allowedCollectionIds).toEqual([])
  })

  test('patch rejects a newly added archived Collection', async () => {
    const existingId = await seedCollection({ lifecycle: 'published', currentPublishedVersion: 1 })
    const archivedId = await seedCollection({ lifecycle: 'archived', currentPublishedVersion: 1 })
    const application = await createApplication([existingId], 'patch-archived')

    await expect(service.patch(
      application.id,
      application.revision,
      { allowedCollectionIds: [existingId, archivedId] },
      { actorId: 'admin-1', idempotencyKey: 'patch-archived-key', requestId: 'patch-archived-request' },
    )).rejects.toMatchObject({ status: 400, code: 'collection_not_grantable' })
  })
})
