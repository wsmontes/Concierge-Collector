import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Model } from 'mongoose'
import type { Payload } from 'payload'
import { lease, page } from '../../support/factories'
import { FakeArtifactStore } from '../../support/fake-artifact-store'
import { createSelectionHarness, type SelectionHarness } from '../../support/selection-harness'
import type { ExportHydrationClient, HydratedRecord } from '../../../src/exports/types'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

function hydrationClient(): ExportHydrationClient {
  return {
    introspectAdmin: vi.fn(async () => undefined),
    hydrate: vi.fn(async (ids: string[]) => ({
      items: ids.map((id) => ({
        curationId: id,
        entityId: `entity-${id}`,
        name: `Restaurant ${id}`,
        curationNote: `note for ${id}`,
      } satisfies HydratedRecord)),
      unavailable: [],
    })),
  }
}

integrationSuite('selection export expiry boundary', () => {
  let payload: Payload
  let exportsModel: Model<Record<string, unknown>>
  let jobs: Model<Record<string, unknown>>
  let manifests: Model<Record<string, unknown>>
  let items: Model<Record<string, unknown>>

  beforeAll(async () => {
    if (!hasTestMongo) return
    const { getSharedPayload } = await import('../support/collection-fixtures')
    payload = await getSharedPayload()
    exportsModel = payload.db.collections['collection-exports'] as unknown as Model<Record<string, unknown>>
    jobs = payload.db.collections['payload-jobs'] as unknown as Model<Record<string, unknown>>
    manifests = payload.db.collections['selection-manifests'] as unknown as Model<Record<string, unknown>>
    items = payload.db.collections['selection-manifest-items'] as unknown as Model<Record<string, unknown>>
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (!hasTestMongo) return
    await Promise.all([
      exportsModel.deleteMany({}),
      jobs.deleteMany({}),
      manifests.deleteMany({}),
      items.deleteMany({}),
    ])
  })

  async function readySelection(harness: SelectionHarness): Promise<string> {
    harness.fastApi.scanPage.mockResolvedValueOnce(page(['c1'], null))
    const selection = await harness.createAllMatchingSelection({ filters: { q: 'expiry-boundary' } })
    await harness.materializeSelection(selection.id, lease())
    return selection.id
  }

  test('worker terminally fails an export whose artifact lifetime elapsed in the queue', async () => {
    const harness = await createSelectionHarness()
    const selectionId = await readySelection(harness)
    const client = hydrationClient()
    const store = new FakeArtifactStore()
    const { createExport, runExportSelection } = await import('../../../src/exports/export-selection')

    const record = await createExport(payload, {
      selectionId,
      actorId: 'admin-1',
      format: 'ndjson',
      idempotencyKey: 'expired-before-worker',
      requestId: 'expired-before-worker-request',
    }, client, { artifactTtlSeconds: 604800 })
    await exportsModel.updateOne({ _id: record.id }, { $set: { expiresAt: new Date(Date.now() - 1_000) } })

    await expect(runExportSelection(payload, record.id, 'cms-admin-worker', {
      store,
      client,
      signedUrlTtlSeconds: 300,
    })).rejects.toMatchObject({ status: 410, code: 'export_expired' })

    expect(store.putCalls).toHaveLength(0)
    expect(await exportsModel.findOne({ _id: record.id }).lean()).toMatchObject({
      status: 'failed',
      key: null,
      leaseExpiresAt: null,
    })
  })

  test('terminal worker URL never outlives the export absolute expiry', async () => {
    const harness = await createSelectionHarness()
    const selectionId = await readySelection(harness)
    const client = hydrationClient()
    const store = new FakeArtifactStore()
    const readUrl = vi.spyOn(store, 'readUrl')
    const { createExport, runExportSelection } = await import('../../../src/exports/export-selection')

    const record = await createExport(payload, {
      selectionId,
      actorId: 'admin-1',
      format: 'ndjson',
      idempotencyKey: 'near-expiry-worker',
      requestId: 'near-expiry-worker-request',
    }, client, { artifactTtlSeconds: 604800 })
    const expiresAt = new Date(Date.now() + 10_000)
    await exportsModel.updateOne({ _id: record.id }, { $set: { expiresAt } })

    const result = await runExportSelection(payload, record.id, 'cms-admin-worker', {
      store,
      client,
      signedUrlTtlSeconds: 300,
    })

    expect(result?.status).toBe('complete')
    expect(readUrl).toHaveBeenCalledTimes(1)
    const effectiveTtl = Number(readUrl.mock.calls[0][1])
    expect(effectiveTtl).toBeGreaterThan(0)
    expect(effectiveTtl).toBeLessThanOrEqual(10)
    expect(result?.downloadExpiresAt.getTime()).toBeLessThanOrEqual(expiresAt.getTime())
  })
})
