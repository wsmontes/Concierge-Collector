import type { Model } from 'mongoose'
import type { Payload } from 'payload'
import { vi, type Mock } from 'vitest'
import type { NormalizedCurationFilters } from '../../src/explorer/types'
import { asRecord, createSelection, materializeSelection as materialize } from '../../src/selections/materialize-selection'
import type {
  CreateSelectionCommand,
  SelectionCatalogClient,
  SelectionManifestRecord,
} from '../../src/selections/types'
import { getSharedPayload } from '../integration/support/collection-fixtures'
import { page, type CatalogScanPage, type JobLease } from './factories'

const ACTOR_ID = 'admin-1'

/**
 * Selection harness for the isolated CMS test database.
 *
 * The harness mocks the typed FastApiAdminClient boundary ONLY (same pattern as
 * draft-operation.int.test.ts): every method is a `vi.fn` so tests can drive
 * scan pages and rejections per test. It never inserts raw operational
 * Curations; manifest rows are produced by the real `createSelection` and
 * `materializeSelection` worker flow.
 */
export interface MockedCatalog extends SelectionCatalogClient {
  introspectAdmin: Mock
  resolveCurations: Mock
  startScan: Mock
  scanPage: Mock
}

export function createMockedCatalog(): MockedCatalog {
  return {
    introspectAdmin: vi.fn(async () => undefined),
    resolveCurations: vi.fn(async (ids: string[]) => ({ eligibleIds: ids, rejected: [] })),
    startScan: vi.fn(
      async (_filters: NormalizedCurationFilters, _actorId: string) =>
        ({ maxCatalogSequence: 100, scanToken: 'scan-token-1' }),
    ),
    // Terminal empty page by default so materialization completes even when a
    // test never wires specific pages.
    scanPage: vi.fn(async (): Promise<CatalogScanPage> => page([], null)),
  }
}

/** A manifest that a selection flow considers ready; shared by later phases. */
export const readySelection: SelectionManifestRecord = {
  actorId: ACTOR_ID,
  candidateCount: 3,
  capturedCount: 3,
  checkpointCursor: null,
  excludedIds: [],
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  fencingToken: 1,
  filters: null,
  id: 'ffffffffffffffffffffffff',
  manifestHash: 'ab'.repeat(32),
  mode: 'all_matching',
  payloadJobId: null,
  requestHash: 'ready-selection-request-hash',
  scanComplete: true,
  scanToken: null,
  skippedCount: 0,
  skippedReasons: {},
  status: 'ready',
}

export type AllMatchingInput = Partial<CreateSelectionCommand> & { filters: NormalizedCurationFilters }

let selectionSequence = 0

function allMatchingCommand(input: AllMatchingInput): CreateSelectionCommand {
  selectionSequence += 1
  return {
    actorId: ACTOR_ID,
    idempotencyKey: `selection-harness-${selectionSequence}`,
    requestId: `selection-harness-${selectionSequence}-request`,
    ...input,
    mode: 'all_matching',
  }
}

async function createAllMatchingWith(
  payload: Payload,
  catalog: SelectionCatalogClient,
  input: AllMatchingInput,
): Promise<SelectionManifestRecord> {
  return createSelection(payload, allMatchingCommand(input), catalog)
}

async function manifestsModel(payload: Payload): Promise<Model<Record<string, unknown>>> {
  const model = payload.db.collections['selection-manifests'] as unknown as Model<Record<string, unknown>> | undefined
  if (!model) throw new Error('Missing selection-manifests model')
  return model
}

async function itemsModel(payload: Payload): Promise<Model<Record<string, unknown>>> {
  const model = payload.db.collections['selection-manifest-items'] as unknown as Model<Record<string, unknown>> | undefined
  if (!model) throw new Error('Missing selection-manifest-items model')
  return model
}

/** Durable curation ids of a manifest in canonical (curationId) order. */
export async function manifestIds(selectionId: string): Promise<string[]> {
  const payload = await getSharedPayload()
  const items = await itemsModel(payload)
  const rows = await items.find({ selectionId }).sort({ curationId: 1 }).lean()
  return rows.map((row) => String((row as { curationId: unknown }).curationId))
}

/** Reloads a selection manifest exactly as the worker flow reads it back. */
export async function loadSelection(selectionId: string): Promise<SelectionManifestRecord> {
  const payload = await getSharedPayload()
  const manifests = await manifestsModel(payload)
  const document = await manifests.findOne({ _id: selectionId }).lean()
  if (!document) throw new Error(`Selection manifest not found: ${selectionId}`)
  return asRecord(document)
}

/** Creates an all-matching intent with a throwaway default mock catalog. */
export async function createAllMatchingSelection(input: AllMatchingInput): Promise<SelectionManifestRecord> {
  const payload = await getSharedPayload()
  return createAllMatchingWith(payload, createMockedCatalog(), input)
}

export interface SelectionHarness {
  payload: Payload
  fastApi: MockedCatalog
  manifests: Model<Record<string, unknown>>
  items: Model<Record<string, unknown>>
  readySelection: SelectionManifestRecord
  createAllMatchingSelection(input: AllMatchingInput): Promise<SelectionManifestRecord>
  /** Runs the real claim/CAS/checkpoint materialization against this harness's mock. */
  materializeSelection(selectionId: string, jobLease: JobLease): Promise<SelectionManifestRecord | null>
  manifestIds(selectionId: string): Promise<string[]>
  loadSelection(selectionId: string): Promise<SelectionManifestRecord>
}

/**
 * Creates an isolated selection harness. The shared Payload instance owns the
 * connection (closed by the support module's afterAll); the mocked catalog is
 * fresh per harness so scan pages never leak between tests.
 */
export async function createSelectionHarness(): Promise<SelectionHarness> {
  const payload = await getSharedPayload()
  const fastApi = createMockedCatalog()
  const manifests = await manifestsModel(payload)
  const items = await itemsModel(payload)
  return {
    payload,
    fastApi,
    manifests,
    items,
    readySelection,
    createAllMatchingSelection: (input) => createAllMatchingWith(payload, fastApi, input),
    materializeSelection: (selectionId, jobLease) => materialize(payload, selectionId, jobLease.owner, fastApi),
    manifestIds: (selectionId) => manifestIds(selectionId),
    loadSelection: (selectionId) => loadSelection(selectionId),
  }
}
