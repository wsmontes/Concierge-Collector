import { createHash } from 'node:crypto'
import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

integrationSuite('consumer credential lifecycle', () => {
  let issueCredential: typeof import('../../../src/applications/credentials').issueCredential
  let rotateCredential: typeof import('../../../src/applications/credentials').rotateCredential
  let revokeCredential: typeof import('../../../src/applications/credentials').revokeCredential
  let PayloadCredentialRepository: typeof import('../../../src/applications/repository').PayloadCredentialRepository
  let ConsumerApplicationService: typeof import('../../../src/applications/service').ConsumerApplicationService
  let applications: import('mongoose').Model<Record<string, unknown>>
  let collections: import('mongoose').Model<Record<string, unknown>>
  let credentials: import('mongoose').Model<Record<string, unknown>>
  let auditEvents: import('mongoose').Model<Record<string, unknown>>
  let connection: import('mongoose').Connection
  let service: import('../../../src/applications/service').ConsumerApplicationService
  let payload: import('payload').Payload

  const NOW = new Date('2026-08-20T10:00:00Z')

  function fixedRandom(size: number): (n: number) => Buffer {
    return (bytes) => Buffer.alloc(bytes, size)
  }

  async function seedPublishedCollection(): Promise<string> {
    const id = new Types.ObjectId().toHexString()
    await collections.create({
      _id: id,
      slug: `credential-integration-${id}`,
      title: `Credential integration ${id}`,
      lifecycle: 'published',
      currentPublishedVersion: 1,
      draftBaseVersion: 1,
      draftEpoch: `epoch-${id}`,
      draftRevision: 0,
      publishFencingToken: 0,
      operationSequenceCounter: 0,
      draftState: 'clean',
      publishedSelectedCount: 0,
      draftSelectedCount: 0,
      revision: 1,
      everPublished: true,
    })
    return id
  }

  async function createApplication(key: string) {
    const collectionId = await seedPublishedCollection()
    const created = await service.create(
      {
        name: `integration-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        owner: 'integration',
        allowedCollectionIds: [collectionId],
        defaultRequestsPerMinute: 60,
      },
      { actorId: 'admin-1', idempotencyKey: `app-${key}`, requestId: `request-${key}` },
    )
    return created as unknown as { id: string }
  }

  /**
   * The exact lookup FastAPI performs for every consumer request, evaluated
   * at an explicit instant. `at` defaults to the same injected clock the
   * commands run under: reading the real clock here would make expiry
   * assertions pass or fail depending on the wall time of the run.
   */
  function authLookup(raw: string, at: Date = NOW) {
    const digest = createHash('sha256').update(raw).digest('hex')
    return credentials.findOne({
      prefix: raw.slice(4, 16),
      secretHash: digest,
      status: 'active',
      $or: [{ expiresAt: null }, { expiresAt: { $gt: at } }],
    })
  }

  beforeAll(async () => {
    // Vitest still executes suite hooks registered inside describe.skip.
    // Return before importing Payload so an explicit no-Mongo run is truly
    // network-free.
    if (!hasTestMongo) return
    const [{ getPayload }, { default: config }, credentialsModule, repositoryModule, serviceModule] = await Promise.all([
      import('payload'),
      import('../../../payload.config'),
      import('../../../src/applications/credentials'),
      import('../../../src/applications/repository'),
      import('../../../src/applications/service'),
    ])
    payload = await getPayload({ config })
    issueCredential = credentialsModule.issueCredential
    rotateCredential = credentialsModule.rotateCredential
    revokeCredential = credentialsModule.revokeCredential
    PayloadCredentialRepository = repositoryModule.PayloadCredentialRepository
    ConsumerApplicationService = serviceModule.ConsumerApplicationService
    service = new ConsumerApplicationService(payload)
    applications = payload.db.collections['consumer-applications'] as unknown as import('mongoose').Model<Record<string, unknown>>
    collections = payload.db.collections.collections as unknown as import('mongoose').Model<Record<string, unknown>>
    credentials = payload.db.collections['consumer-credentials'] as unknown as import('mongoose').Model<Record<string, unknown>>
    auditEvents = payload.db.collections['audit-events'] as unknown as import('mongoose').Model<Record<string, unknown>>
    connection = payload.db.connection
  })

  afterEach(async () => {
    if (!hasTestMongo) return
    await Promise.all([
      applications.deleteMany({}),
      collections.deleteMany({}),
      credentials.deleteMany({}),
      auditEvents.deleteMany({}),
    ])
  })

  afterAll(async () => {
    if (!hasTestMongo) return
    await connection?.close()
  })

  test('issue persists only the hash and no document anywhere holds the raw secret', async () => {
    const application = await createApplication('issue')
    const repo = new PayloadCredentialRepository(payload, 'admin-1', 'request-issue')
    const result = await issueCredential(
      { applicationId: application.id, name: 'production', scopes: ['collections:read'], expiresAt: null, actorId: 'admin-1', idempotencyKey: 'issue-key-1' },
      repo, fixedRandom(7), NOW,
    )

    expect(result.secretOnce).toMatch(/^cck_[a-f0-9]{12}_[A-Za-z0-9_-]+$/)
    const stored = await credentials.findOne({ _id: result.credential.id }).lean()
    expect(String(stored?.secretHash)).toMatch(/^[a-f0-9]{64}$/)
    expect(String(stored?.secretHash)).toBe(createHash('sha256').update(result.secretOnce).digest('hex'))
    expect(String(stored?.prefix)).toBe(result.secretOnce.slice(4, 16))

    // Direct textual inspection of the test collections: the raw secret must
    // not appear in any document, any field, or any audit event.
    const credentialDocuments = await credentials.find({}).lean()
    const auditDocuments = await auditEvents.find({}).lean()
    const applicationDocuments = await applications.find({}).lean()
    expect(JSON.stringify(credentialDocuments)).not.toContain(result.secretOnce)
    expect(JSON.stringify(auditDocuments)).not.toContain(result.secretOnce)
    expect(JSON.stringify(applicationDocuments)).not.toContain(result.secretOnce)

    expect(await authLookup(result.secretOnce)).toBeTruthy()
    expect(Number((await applications.findById(application.id).lean())?.credentialsRevision ?? -1)).toBe(1)
  })

  test('rotate issues a show-once secret and keeps the old credential valid until overlapUntil', async () => {
    const application = await createApplication('rotate')
    const repo = new PayloadCredentialRepository(payload, 'admin-1', 'request-rotate')
    const issued = await issueCredential(
      { applicationId: application.id, name: 'production', scopes: ['collections:read'], expiresAt: null, actorId: 'admin-1', idempotencyKey: 'rotate-issue-key' },
      repo, fixedRandom(9), NOW,
    )
    const overlapUntil = new Date('2026-08-20T11:00:00Z')
    const rotated = await rotateCredential(
      issued.credential.id,
      { actorId: 'admin-1', idempotencyKey: 'rotate-key-1', overlapUntil },
      repo, fixedRandom(11), NOW,
    )

    expect(rotated.secretOnce).not.toBe(issued.secretOnce)
    expect(rotated.credential.id).not.toBe(issued.credential.id)
    // Both credentials authenticate inside the overlap window.
    expect(await authLookup(issued.secretOnce)).toBeTruthy()
    expect(await authLookup(rotated.secretOnce)).toBeTruthy()
    // One second past the window only the replacement still authenticates.
    const afterOverlap = new Date(overlapUntil.getTime() + 1000)
    expect(await authLookup(issued.secretOnce, afterOverlap)).toBeNull()
    expect(await authLookup(rotated.secretOnce, afterOverlap)).toBeTruthy()

    const oldDocument = await credentials.findById(issued.credential.id).lean()
    expect(String(oldDocument?.status)).toBe('active')
    expect(new Date(oldDocument?.expiresAt as string).toISOString()).toBe(overlapUntil.toISOString())
    const newDocument = await credentials.findById(rotated.credential.id).lean()
    expect(String(newDocument?.status)).toBe('active')
    expect(newDocument?.expiresAt).toBeNull()

    const documents = await credentials.find({}).lean()
    expect(JSON.stringify(documents)).not.toContain(issued.secretOnce)
    expect(JSON.stringify(documents)).not.toContain(rotated.secretOnce)

    expect(await auditEvents.countDocuments({ credentialId: issued.credential.id, eventType: 'credential.rotated' })).toBe(1)
    // issue bumped once, rotate bumped once: total two transitions.
    expect(Number((await applications.findById(application.id).lean())?.credentialsRevision ?? -1)).toBe(2)
  })

  test('revoke rejects the next authentication attempt and stays idempotent', async () => {
    const application = await createApplication('revoke')
    const repo = new PayloadCredentialRepository(payload, 'admin-1', 'request-revoke')
    const issued = await issueCredential(
      { applicationId: application.id, name: 'production', scopes: ['collections:read'], expiresAt: null, actorId: 'admin-1', idempotencyKey: 'revoke-issue-key' },
      repo, fixedRandom(13), NOW,
    )
    expect(await authLookup(issued.secretOnce)).toBeTruthy()

    await revokeCredential(issued.credential.id, 'admin-1', repo, NOW)
    // The exact FastAPI lookup now rejects the previously valid credential.
    expect(await authLookup(issued.secretOnce)).toBeNull()

    const firstDocument = await credentials.findById(issued.credential.id).lean()
    expect(String(firstDocument?.status)).toBe('revoked')
    const retry = await revokeCredential(issued.credential.id, 'admin-1', repo, new Date('2026-08-20T12:00:00Z'))
    expect(retry.revokedAt?.toISOString()).toBe(new Date(firstDocument?.revokedAt as string).toISOString())
    expect(await auditEvents.countDocuments({ credentialId: issued.credential.id, eventType: 'credential.revoked' })).toBe(1)
    // issue bumped once, revoke bumped once: total two transitions.
    expect(Number((await applications.findById(application.id).lean())?.credentialsRevision ?? -1)).toBe(2)
  })
})
