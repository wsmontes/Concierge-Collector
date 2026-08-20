import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

integrationSuite('Collection lifecycle repository', () => {
  let repository: import('../../../src/collections/repository').CollectionRepository
  let collections: import('mongoose').Model<Record<string, unknown>>
  let auditEvents: import('mongoose').Model<Record<string, unknown>>
  let connection: import('mongoose').Connection

  const audit = { actorId: 'admin-1', idempotencyKey: 'request-key', requestId: 'request-1' }

  beforeAll(async () => {
    // Vitest still executes suite hooks registered inside describe.skip.
    // Return before importing Payload so an explicit no-Mongo run is truly
    // network-free.
    if (!hasTestMongo) return
    const [{ getPayload }, { default: config }, { createCollectionRepository }] = await Promise.all([
      import('payload'),
      import('../../../payload.config'),
      import('../../../src/collections/repository'),
    ])
    const payload = await getPayload({ config })
    repository = createCollectionRepository(payload)
    collections = payload.db.collections.collections as unknown as import('mongoose').Model<Record<string, unknown>>
    auditEvents = payload.db.collections['audit-events'] as unknown as import('mongoose').Model<Record<string, unknown>>
    connection = payload.db.connection
  })

  afterEach(async () => {
    if (!hasTestMongo) return
    await Promise.all([collections.deleteMany({}), auditEvents.deleteMany({})])
  })

  afterAll(async () => {
    if (!hasTestMongo) return
    await connection?.close()
  })

  test('normalizes slug, rejects a duplicate and persists an audit event', async () => {
    const created = await repository.createCollection({ slug: 'São Paulo — Sushi', title: 'Sushi' }, audit)
    expect(created.slug).toBe('sao-paulo-sushi')

    await expect(repository.createCollection({ slug: 'sao paulo sushi', title: 'Duplicate' }, {
      ...audit,
      idempotencyKey: 'request-key-2',
    })).rejects.toMatchObject({ status: 409, code: 'conflict' })
    await expect(auditEvents.countDocuments({ collectionId: created.id })).resolves.toBe(1)
  })

  test('returns the original lifecycle result for an idempotent retry and rejects a reused key with another command', async () => {
    const first = await repository.createCollection({ slug: 'idempotent-create', title: 'Idempotent' }, audit)
    const retry = await repository.createCollection({ slug: 'idempotent-create', title: 'Idempotent' }, audit)

    expect(retry.id).toBe(first.id)
    await expect(repository.createCollection({ slug: 'different-command', title: 'Different' }, audit))
      .rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' })
    await expect(auditEvents.countDocuments({ collectionId: first.id })).resolves.toBe(1)
  })

  test('replays a metadata command snapshot even after its If-Match revision is stale', async () => {
    const created = await repository.createCollection({ slug: 'idempotent-patch', title: 'Before' }, audit)
    const command = { ...audit, idempotencyKey: 'patch-key' }
    const first = await repository.patchCollectionMetadata(created.id, created.revision, { title: 'After' }, command)
    const retry = await repository.patchCollectionMetadata(created.id, created.revision, { title: 'After' }, command)

    expect(retry).toMatchObject({ id: first.id, revision: first.revision, title: 'After' })
    await expect(repository.patchCollectionMetadata(created.id, created.revision, { title: 'Different' }, command))
      .rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' })
  })

  test('returns 400 for malformed lifecycle metadata and 404 for a malformed ObjectId', async () => {
    await expect(repository.createCollection({ slug: '---', title: 'Bad' }, audit))
      .rejects.toMatchObject({ status: 400, code: 'invalid_request' })
    await expect(repository.createCollection({ slug: 'valid-slug', title: '   ' }, {
      ...audit,
      idempotencyKey: 'invalid-title',
    })).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
    await expect(repository.getCollection('not-an-object-id')).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  test('uses If-Match CAS and only hard-deletes a never-published collection', async () => {
    const created = await repository.createCollection({ slug: 'cas-delete', title: 'CAS' }, audit)

    await expect(repository.patchCollectionMetadata(created.id, 99, { title: 'Stale' }, audit))
      .rejects.toMatchObject({ status: 412, code: 'revision_conflict' })
    await repository.hardDeleteNeverPublished(created.id, created.revision, audit)
    await expect(repository.getCollection(created.id)).rejects.toMatchObject({ status: 404 })
  })

  test('archives and restores without changing the published version and appends audit events', async () => {
    const created = await repository.createCollection({ slug: 'archive-restore', title: 'Archive' }, audit)
    await collections.updateOne({ _id: created.id }, {
      $set: {
        lifecycle: 'published',
        everPublished: true,
        currentPublishedVersion: 7,
        draftBaseVersion: 7,
        revision: 3,
      },
    })
    const published = await repository.getCollection(created.id)

    const archived = await repository.archiveCollection(created.id, published.revision, {
      ...audit,
      idempotencyKey: 'archive-key',
    })
    expect(archived).toMatchObject({ lifecycle: 'archived', currentPublishedVersion: 7, revision: 4 })

    const restored = await repository.restoreCollection(created.id, archived.revision, {
      ...audit,
      idempotencyKey: 'restore-key',
    })
    expect(restored).toMatchObject({ lifecycle: 'published', currentPublishedVersion: 7, revision: 5 })
    await expect(auditEvents.countDocuments({ collectionId: created.id })).resolves.toBe(3)
  })
})
