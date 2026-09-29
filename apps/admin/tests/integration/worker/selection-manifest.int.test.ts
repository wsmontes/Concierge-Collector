import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Model } from 'mongoose'
import type { Payload } from 'payload'
import { lease, page } from '../../support/factories'
import {
  createSelectionHarness,
  readySelection,
  type SelectionHarness,
} from '../../support/selection-harness'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

integrationSuite('selection manifest materialization', () => {
  let payload: Payload
  let manifests: Model<Record<string, unknown>>
  let items: Model<Record<string, unknown>>
  let jobs: Model<Record<string, unknown>>
  let sessions: Model<Record<string, unknown>>
  let users: Model<Record<string, unknown>>

  beforeAll(async () => {
    if (!hasTestMongo) return
    const { getSharedPayload } = await import('../support/collection-fixtures')
    payload = await getSharedPayload()
    manifests = payload.db.collections['selection-manifests'] as unknown as Model<Record<string, unknown>>
    items = payload.db.collections['selection-manifest-items'] as unknown as Model<Record<string, unknown>>
    jobs = payload.db.collections['payload-jobs'] as unknown as Model<Record<string, unknown>>
    sessions = payload.db.collections['cms-sessions'] as unknown as Model<Record<string, unknown>>
    users = payload.db.collections['cms-users'] as unknown as Model<Record<string, unknown>>
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (!hasTestMongo) return
    await Promise.all([
      manifests.deleteMany({}),
      items.deleteMany({}),
      jobs.deleteMany({}),
      sessions.deleteMany({}),
      users.deleteMany({}),
    ])
  })

  test('retry da mesma página não duplica manifest item', async () => {
    const { createAllMatchingSelection, fastApi, manifestIds, loadSelection, materializeSelection } =
      await createSelectionHarness()
    const selection = await createAllMatchingSelection({ filters: { q: 'sushi' } })
    fastApi.scanPage
      .mockResolvedValueOnce(page(['c1', 'c2'], 'cursor-2'))
      .mockResolvedValueOnce(page(['c1', 'c2'], 'cursor-2'))
      .mockResolvedValueOnce(page(['c3'], null))
    await materializeSelection(selection.id, lease())
    expect(await manifestIds(selection.id)).toEqual(['c1', 'c2', 'c3'])
    expect((await loadSelection(selection.id)).capturedCount).toBe(3)
  })

  test('exclusões mantêm captured + skipped = candidate no manifest ready', async () => {
    const { createAllMatchingSelection, fastApi, manifestIds, loadSelection, materializeSelection } =
      await createSelectionHarness()
    const selection = await createAllMatchingSelection({ filters: { q: 'sushi' }, excludedIds: ['c2'] })
    fastApi.scanPage
      .mockResolvedValueOnce(page(['c1', 'c2'], 'cursor-2'))
      .mockResolvedValueOnce(page(['c3'], null))
    await materializeSelection(selection.id, lease())
    const ready = await loadSelection(selection.id)
    expect(ready.status).toBe('ready')
    expect(ready.candidateCount).toBe(3)
    expect(ready.capturedCount).toBe(2)
    expect(ready.skippedCount).toBe(1)
    expect(ready.capturedCount + ready.skippedCount).toBe(ready.candidateCount)
    expect(ready.manifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await manifestIds(selection.id)).toEqual(['c1', 'c3'])
  })

  test('unique (selectionId, curationId) absorve retry no upsert e rejeita duplicata crua', async () => {
    const { createAllMatchingSelection, fastApi, manifestIds, materializeSelection } = await createSelectionHarness()
    const indexNames = (await items.collection.indexes()).map((index) => index.name)
    expect(indexNames).toContain('selection_item_unique')

    const selection = await createAllMatchingSelection({ filters: { q: 'sushi' } })
    fastApi.scanPage.mockResolvedValueOnce(page(['c1', 'c1', 'c2'], null))
    await materializeSelection(selection.id, lease())
    expect(await manifestIds(selection.id)).toEqual(['c1', 'c2'])

    // A raw duplicate insert must be rejected by the unique index itself.
    await expect(items.create({
      selectionId: selection.id, curationId: 'c1', expiresAt: new Date(),
    })).rejects.toMatchObject({ code: 11000 })
  })

  test('manifest e itens herdam expiresAt TTL de 24h com índices TTL', async () => {
    const { createAllMatchingSelection, fastApi, loadSelection, materializeSelection } = await createSelectionHarness()
    const selection = await createAllMatchingSelection({ filters: { q: 'sushi' } })
    fastApi.scanPage.mockResolvedValueOnce(page(['c1'], null))
    await materializeSelection(selection.id, lease())

    const ready = await loadSelection(selection.id)
    expect(ready.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000)
    expect(ready.expiresAt.getTime()).toBeLessThan(Date.now() + 25 * 60 * 60 * 1000)

    const rows = await items.find({ selectionId: selection.id }).lean()
    expect(rows).toHaveLength(1)
    expect(((rows[0] as { expiresAt: Date }).expiresAt).getTime()).toBe(ready.expiresAt.getTime())

    const manifestIndexes = await manifests.collection.indexes()
    expect(manifestIndexes).toContainEqual(expect.objectContaining({ name: 'selection_manifest_ttl', expireAfterSeconds: 0 }))
    const itemIndexes = await items.collection.indexes()
    expect(itemIndexes).toContainEqual(expect.objectContaining({ name: 'selection_item_ttl', expireAfterSeconds: 0 }))
  })

  test('request idempotente reutiliza o mesmo manifest sem reiniciar o scan', async () => {
    const { createAllMatchingSelection, fastApi, loadSelection } = await createSelectionHarness()
    const input = { filters: { q: 'sushi' }, idempotencyKey: 'idem-key-1', requestId: 'idem-request-1' }
    const first = await createAllMatchingSelection(input)
    const retried = await createAllMatchingSelection(input)
    expect(retried.id).toBe(first.id)
    expect(fastApi.startScan).toHaveBeenCalledTimes(1)
    expect(fastApi.startScan).toHaveBeenCalledWith({ q: 'sushi' }, 'admin-1')
    expect((await loadSelection(first.id)).status).toBe('queued')
  })

  test('readySelection fixture expõe um manifest pronto para fases seguintes', () => {
    expect(readySelection).toMatchObject({
      id: 'ffffffffffffffffffffffff',
      mode: 'all_matching',
      status: 'ready',
      capturedCount: 3,
      scanComplete: true,
    })
  })
})
