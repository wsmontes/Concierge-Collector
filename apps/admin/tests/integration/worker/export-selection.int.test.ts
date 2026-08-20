import { createHash } from 'node:crypto'
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

function hydrateClient(overrides: { failFirstHydrate?: boolean } = {}): {
  client: ExportHydrationClient
  hydrate: ReturnType<typeof vi.fn>
} {
  const hydrate = vi.fn(async (ids: string[]): Promise<{ items: HydratedRecord[]; unavailable: Array<{ curationId: string; reason: string }> }> => ({
    items: ids.map((id) => ({
      curationId: id,
      entityId: `entity-${id}`,
      name: `Restaurant ${id}`,
      curationNote: `note for ${id}`,
      // Non-public payload riding on the wire; the writer must never emit it.
      transcript: `private-transcript-${id}`,
    } as unknown as HydratedRecord)),
    unavailable: [],
  }))
  if (overrides.failFirstHydrate) {
    hydrate.mockImplementationOnce(async () => { throw new Error('simulated_hydration_failure') })
  }
  return { client: { introspectAdmin: vi.fn(async () => undefined), hydrate }, hydrate }
}

integrationSuite('selection export to object storage', () => {
  let payload: Payload
  let exportsModel: Model<Record<string, unknown>>
  let jobs: Model<Record<string, unknown>>
  let manifests: Model<Record<string, unknown>>
  let items: Model<Record<string, unknown>>
  let sessions: Model<Record<string, unknown>>
  let users: Model<Record<string, unknown>>

  beforeAll(async () => {
    if (!hasTestMongo) return
    const { getSharedPayload } = await import('../support/collection-fixtures')
    payload = await getSharedPayload()
    exportsModel = payload.db.collections['collection-exports'] as unknown as Model<Record<string, unknown>>
    jobs = payload.db.collections['payload-jobs'] as unknown as Model<Record<string, unknown>>
    manifests = payload.db.collections['selection-manifests'] as unknown as Model<Record<string, unknown>>
    items = payload.db.collections['selection-manifest-items'] as unknown as Model<Record<string, unknown>>
    sessions = payload.db.collections['cms-sessions'] as unknown as Model<Record<string, unknown>>
    users = payload.db.collections['cms-users'] as unknown as Model<Record<string, unknown>>
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (!hasTestMongo) return
    await Promise.all([
      exportsModel.deleteMany({}),
      jobs.deleteMany({}),
      manifests.deleteMany({}),
      items.deleteMany({}),
      sessions.deleteMany({}),
      users.deleteMany({}),
    ])
  })

  /** Real ready manifest with durable item rows, driven by the harness catalog. */
  async function readySelection(harness: SelectionHarness): Promise<{ selectionId: string }> {
    harness.fastApi.scanPage.mockResolvedValueOnce(page(['c1', 'c2', 'c3'], null))
    const selection = await harness.createAllMatchingSelection({ filters: { q: 'sushi' } })
    await harness.materializeSelection(selection.id, lease())
    return { selectionId: selection.id }
  }

  test('export streams allowlisted records and stores a private artifact', async () => {
    const harness = await createSelectionHarness()
    const { selectionId } = await readySelection(harness)
    const { client } = hydrateClient()
    const store = new FakeArtifactStore()

    const { exportSelectionTask } = await import('../../../src/jobs/exportSelectionTask')
    const result = await exportSelectionTask.run({ selectionId, format: 'ndjson' }, {
      store, client, payload: harness.payload, signedUrlTtlSeconds: 300,
    })

    expect(result.status).toBe('complete')
    expect(store.putCalls[0].contentType).toBe('application/x-ndjson')
    expect(store.putCalls[0].capturedUtf8).not.toContain('transcript')
    expect(result.downloadExpiresAt).toBeTruthy()
    expect(result.downloadUrl).not.toContain('public-read')

    // The persisted record only becomes complete with the post-upload digest.
    const record = await exportsModel.findOne({ selectionId }).lean()
    expect(record).toMatchObject({ status: 'complete', contentType: 'application/x-ndjson', sha256: store.putCalls[0].artifact.sha256 })
    const bytesDigest = createHash('sha256').update(store.putCalls[0].capturedUtf8).digest('hex')
    expect(store.putCalls[0].artifact.sha256).toBe(bytesDigest)
  })

  test('retry de página não duplica records e o sha256 cobre os bytes enviados', async () => {
    const harness = await createSelectionHarness()
    const { selectionId } = await readySelection(harness)
    const { client } = hydrateClient({ failFirstHydrate: true })
    const store = new FakeArtifactStore()

    const { createExport, runExportSelection } = await import('../../../src/exports/export-selection')
    const record = await createExport(payload, {
      selectionId, actorId: 'admin-1', format: 'ndjson', idempotencyKey: 'export-retry-1', requestId: 'export-retry-1-request',
    }, client)

    await expect(runExportSelection(payload, record.id, 'cms-admin-worker', { store, client, signedUrlTtlSeconds: 300 }))
      .rejects.toThrow('simulated_hydration_failure')

    const retried = await runExportSelection(payload, record.id, 'cms-admin-worker', { store, client, signedUrlTtlSeconds: 300 })
    expect(retried?.status).toBe('complete')
    expect(store.putCalls).toHaveLength(1)

    const lines = store.putCalls[0].capturedUtf8.trimEnd().split('\n').map((line) => JSON.parse(line))
    const curationIds = lines.filter((line) => line.record_type === 'item').map((line) => line.item.curation_id)
    expect(curationIds).toEqual(['c1', 'c2', 'c3'])
    expect(new Set(curationIds).size).toBe(3)

    const rawLines = store.putCalls[0].capturedUtf8.split('\n').slice(0, -1)
    const itemRaw = rawLines.slice(1, -1)
    const digest = createHash('sha256').update(itemRaw.join('\n') + '\n').digest('hex')
    expect(lines[lines.length - 1].sha256).toBe(digest)
    // The stored artifact digest covers every byte actually sent (manifest +
    // items + footer), which is a different — stronger — integrity claim.
    const bytesDigest = createHash('sha256').update(store.putCalls[0].capturedUtf8).digest('hex')
    expect(store.putCalls[0].artifact.sha256).toBe(bytesDigest)
  })

  test('NDJSON termina com manifest e footer válidos e conta indisponíveis', async () => {
    const harness = await createSelectionHarness()
    const { selectionId } = await readySelection(harness)
    const hydrate = vi.fn(async (ids: string[]) => ({
      items: ids.filter((id) => id !== 'c2').map((id) => ({
        curationId: id, entityId: `entity-${id}`, name: `Restaurant ${id}`, curationNote: null,
      })),
      unavailable: ids.includes('c2') ? [{ curationId: 'c2', reason: 'curation_not_public' }] : [],
    }))
    const client = { introspectAdmin: vi.fn(async () => undefined), hydrate }
    const store = new FakeArtifactStore()

    const { exportSelectionTask } = await import('../../../src/jobs/exportSelectionTask')
    await exportSelectionTask.run({ selectionId, format: 'ndjson' }, {
      store, client, payload: harness.payload, signedUrlTtlSeconds: 300,
    })

    const lines = store.putCalls[0].capturedUtf8.trimEnd().split('\n').map((line) => JSON.parse(line))
    expect(lines[0]).toMatchObject({ record_type: 'manifest', selection_id: selectionId, selected_count: 3 })
    const itemLines = lines.filter((line) => line.record_type === 'item')
    expect(itemLines).toHaveLength(2)
    const footer = lines[lines.length - 1]
    expect(footer.record_type).toBe('footer')
    expect(footer).toMatchObject({
      selected_count: 3, available_count: 2, unavailable_count: 1,
      unavailable_reasons: { curation_not_public: 1 },
    })
    expect(footer.sha256).toMatch(/^[a-f0-9]{64}$/)

    const rawLines = store.putCalls[0].capturedUtf8.split('\n').slice(0, -1)
    const itemRaw = rawLines.slice(1, -1)
    const digest = createHash('sha256').update(itemRaw.join('\n') + '\n').digest('hex')
    expect(footer.sha256).toBe(digest)
  })

  test('CSV export tem apenas header + rows e contentType text/csv', async () => {
    const harness = await createSelectionHarness()
    const { selectionId } = await readySelection(harness)
    const { client } = hydrateClient()
    const store = new FakeArtifactStore()

    const { exportSelectionTask } = await import('../../../src/jobs/exportSelectionTask')
    const result = await exportSelectionTask.run({ selectionId, format: 'csv' }, {
      store, client, payload: harness.payload, signedUrlTtlSeconds: 300,
    })

    expect(result.status).toBe('complete')
    expect(store.putCalls[0].contentType).toBe('text/csv')
    const csv = store.putCalls[0].capturedUtf8
    expect(csv.startsWith('curation_id,entity_id,name,curation_note\n')).toBe(true)
    expect(csv.split('\n').filter(Boolean)).toHaveLength(4)
    expect(csv).not.toContain('record_type')
    expect(csv).not.toContain('transcript')
  })

  test('POST idempotente reutiliza o mesmo export e seleção expirada vira 410', async () => {
    const harness = await createSelectionHarness()
    const { selectionId } = await readySelection(harness)
    const { client } = hydrateClient()

    const { createExport } = await import('../../../src/exports/export-selection')
    const command = {
      selectionId, actorId: 'admin-1', format: 'ndjson' as const, idempotencyKey: 'export-idem-1', requestId: 'export-idem-1-request',
    }
    const first = await createExport(payload, command, client)
    const second = await createExport(payload, { ...command, requestId: 'export-idem-1-request-2' }, client)
    expect(second.id).toBe(first.id)
    expect(await jobs.countDocuments({ input: { selectionId, exportId: first.id } })).toBe(1)
    expect(first.payloadJobId).toBeTruthy()

    // Same key with a different format is an idempotency conflict.
    await expect(createExport(payload, { ...command, format: 'csv' }, client)).rejects.toMatchObject({ status: 409 })
    // A different key may export the same selection again.
    const other = await createExport(payload, { ...command, idempotencyKey: 'export-idem-other', requestId: 'r' }, client)
    expect(other.id).not.toBe(first.id)

    await manifests.updateOne({ _id: selectionId }, { $set: { expiresAt: new Date(Date.now() - 1_000) } })
    await expect(createExport(payload, { ...command, idempotencyKey: 'export-idem-2', requestId: 'export-idem-2-request' }, client))
      .rejects.toMatchObject({ status: 410 })

    const notReady = await harness.createAllMatchingSelection({ filters: { q: 'queued-only' } })
    await expect(createExport(payload, {
      selectionId: notReady.id, actorId: 'admin-1', format: 'ndjson', idempotencyKey: 'export-not-ready', requestId: 'r2',
    }, client)).rejects.toMatchObject({ status: 409 })
  })
})
