import { createHash } from 'node:crypto'
import { Types, type ClientSession, type Model } from 'mongoose'
import type { Payload } from 'payload'
import { AdminHttpError } from '../http/errors'
import type { ArtifactStore } from '../storage/artifact-store'
import { readArtifactStorageEnv } from '../env'
import type {
  CreateExportCommand,
  ExportFormat,
  ExportHydrationClient,
  ExportRecord,
  ExportRunResult,
  ExportStatus,
  HydratedRecord,
} from './types'
import { FastApiExportHydrationClient } from './hydration-client'

type DocumentModel = Model<Record<string, unknown>>

const LEASE_MS = 60_000
const PAGE_LIMIT = 500
/** Staging/default artifact retention; production overrides via EXPORT_ARTIFACT_TTL_SECONDS. */
const DEFAULT_ARTIFACT_TTL_SECONDS = 604800

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

async function inTransaction<T>(payload: Payload, work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await payload.db.connection.startSession()
  try {
    let result: T | undefined
    await session.withTransaction(async () => { result = await work(session) })
    return result as T
  } finally {
    await session.endSession()
  }
}

export function asRecord(document: unknown): ExportRecord {
  const value = document as Record<string, unknown>
  return {
    ...value,
    id: String(value.id ?? value._id),
    selectionId: String(value.selectionId ?? ''),
    actorId: String(value.actorId ?? ''),
    status: (value.status as ExportStatus) ?? 'queued',
    format: (value.format as ExportFormat) ?? 'ndjson',
    progress: (value.progress as Record<string, number>) ?? {},
    key: (value.key as string | null) ?? null,
    contentType: (value.contentType as string | null) ?? null,
    sha256: (value.sha256 as string | null) ?? null,
    expiresAt: new Date(String(value.expiresAt)),
    idempotencyKey: String(value.idempotencyKey ?? ''),
    requestHash: String(value.requestHash ?? ''),
    requestId: String(value.requestId ?? ''),
    payloadJobId: (value.payloadJobId as string | null) ?? null,
    leaseOwner: (value.leaseOwner as string | null) ?? null,
    leaseExpiresAt: value.leaseExpiresAt ? new Date(String(value.leaseExpiresAt)) : null,
    fencingToken: Number(value.fencingToken) || 0,
  }
}

interface ReadySelection {
  id: string
  actorId: string
  capturedCount: number
  manifestHash: string
  expiresAt: Date
}

/** The exportable manifest is ready, owned by the actor and not expired. */
async function loadReadyManifest(payload: Payload, selectionId: string, actorId: string): Promise<ReadySelection> {
  const manifest = await modelFor(payload, 'selection-manifests').findOne({ _id: selectionId, actorId }).lean()
  if (!manifest) throw new AdminHttpError(404, 'not_found')
  const expiresAt = new Date(String(manifest.expiresAt))
  if (expiresAt.getTime() <= Date.now()) throw new AdminHttpError(410, 'selection_expired')
  if (manifest.status !== 'ready') throw new AdminHttpError(409, 'conflict')
  return {
    id: String(manifest._id),
    actorId,
    capturedCount: Number(manifest.capturedCount) || 0,
    manifestHash: String(manifest.manifestHash ?? ''),
    expiresAt,
  }
}

function exportRequestHash(command: CreateExportCommand): string {
  return createHash('sha256').update(JSON.stringify({
    actorId: command.actorId, selectionId: command.selectionId, format: command.format,
  })).digest('hex')
}

async function existingExport(exportsModel: DocumentModel, actorId: string, idempotencyKey: string, hash: string): Promise<ExportRecord | null> {
  const document = await exportsModel.findOne({ actorId, idempotencyKey }).lean()
  if (!document) return null
  const record = asRecord(document)
  if (record.requestHash !== hash) throw new AdminHttpError(409, 'idempotency_conflict')
  return record
}

async function recoverIdempotencyRace(
  exportsModel: DocumentModel,
  actorId: string,
  idempotencyKey: string,
  hash: string,
  persist: () => Promise<void>,
): Promise<ExportRecord | null> {
  try {
    await persist()
    return null
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000) {
      const winner = await existingExport(exportsModel, actorId, idempotencyKey, hash)
      if (winner) return winner
    }
    throw error
  }
}

/**
 * Registers an export intent for a ready manifest: idempotent by
 * `(actorId, idempotencyKey)` and enqueued as a `selection-exports` Payload
 * job. Never exports a non-ready or expired selection.
 */
export async function createExport(
  payload: Payload,
  command: CreateExportCommand,
  client: ExportHydrationClient = new FastApiExportHydrationClient(),
  options: { artifactTtlSeconds?: number } = {},
): Promise<ExportRecord> {
  if (!command.actorId || !command.idempotencyKey || !command.requestId) throw new AdminHttpError(400, 'invalid_request')
  if (command.format !== 'ndjson' && command.format !== 'csv') throw new AdminHttpError(400, 'invalid_request')
  await loadReadyManifest(payload, command.selectionId, command.actorId)
  const hash = exportRequestHash(command)
  const exportsModel = modelFor(payload, 'collection-exports')
  const already = await existingExport(exportsModel, command.actorId, command.idempotencyKey, hash)
  if (already) return already

  await client.introspectAdmin(command.actorId)
  const now = new Date()
  const ttlSeconds = options.artifactTtlSeconds ?? DEFAULT_ARTIFACT_TTL_SECONDS
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
  const id = new Types.ObjectId().toHexString()
  const payloadJobId = new Types.ObjectId().toHexString()
  const document: Record<string, unknown> = {
    _id: id, selectionId: command.selectionId, actorId: command.actorId, format: command.format,
    status: 'queued', progress: {}, key: null, contentType: null, sha256: null, expiresAt,
    idempotencyKey: command.idempotencyKey, requestHash: hash, requestId: command.requestId, payloadJobId,
    leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, createdAt: now, updatedAt: now,
  }
  const raced = await recoverIdempotencyRace(exportsModel, command.actorId, command.idempotencyKey, hash, () => inTransaction(payload, async (session) => {
    await exportsModel.create([document], { session })
    await modelFor(payload, 'payload-jobs').create([{
      _id: payloadJobId, input: { selectionId: command.selectionId, exportId: id },
      taskSlug: 'export-selection', queue: 'selection-exports',
      processing: false, totalTried: 0, hasError: false, createdAt: now, updatedAt: now,
    }], { session })
  }))
  if (raced) return raced
  return asRecord(document)
}

async function claimExport(payload: Payload, exportId: string, owner: string): Promise<{ record: ExportRecord; lease: { owner: string; fencingToken: number } } | null> {
  const exportsModel = modelFor(payload, 'collection-exports')
  const now = new Date()
  const document = await exportsModel.findOneAndUpdate(
    { _id: exportId, status: { $in: ['queued', 'running'] }, $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lt: now } }, { leaseOwner: owner }] },
    { $set: { status: 'running', leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: now }, $inc: { fencingToken: 1 } },
    { new: true, lean: true },
  )
  if (!document) return null
  const record = asRecord(document)
  return { record, lease: { owner, fencingToken: record.fencingToken } }
}

/** Canonical JSON line (stable key order) mirroring the distribution dump encoder. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      output[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return output
  }
  return value
}

function encodeRecord(record: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(canonicalize(record))}\n`)
}

function csvField(value: string | null): string {
  if (value === null) return ''
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

const CSV_HEADER = 'curation_id,entity_id,name,curation_note\n'

/**
 * Bounded-memory NDJSON/CSV stream of allowlisted records: manifest line
 * (NDJSON only), then item records from hydration batches of 500, then a
 * footer (NDJSON only) carrying counts, unavailable reasons and the logical
 * SHA-256 of the item lines. A hydration failure propagates out of the
 * generator so consumers observe a partial stream without the footer.
 */
async function* writeSelectionStream(input: {
  payload: Payload
  format: ExportFormat
  manifest: ReadySelection
  client: ExportHydrationClient
  onProgress: (progress: Record<string, number>) => void
}): AsyncGenerator<Uint8Array> {
  const { payload, format, manifest, client, onProgress } = input
  if (format === 'ndjson') {
    yield encodeRecord({
      record_type: 'manifest',
      selection_id: manifest.id,
      actor_id: manifest.actorId,
      format: 'ndjson',
      exported_at: new Date().toISOString(),
      selected_count: manifest.capturedCount,
      manifest_hash: manifest.manifestHash,
    })
  } else {
    yield new TextEncoder().encode(CSV_HEADER)
  }

  const digest = createHash('sha256')
  let availableCount = 0
  let unavailableCount = 0
  const unavailableReasons: Record<string, number> = {}
  let processed = 0
  let batches = 0
  let cursor: string | null = null
  while (true) {
    const query = modelFor(payload, 'selection-manifest-items').find({ selectionId: manifest.id }).sort({ curationId: 1 }).limit(PAGE_LIMIT)
    // curationId is a text field; mongoose's .gt() is typed for numbers, but
    // the value really is the string id of the last item of the previous page.
    if (cursor !== null) query.where('curationId').gt(cursor as unknown as number)
    const rows = await query.lean()
    if (!rows.length) break
    const curationIds = rows.map((row) => String((row as unknown as { curationId: unknown }).curationId))
    cursor = curationIds[curationIds.length - 1]
    batches += 1

    if (batches > 1) await client.introspectAdmin(manifest.actorId)
    const hydrated = await client.hydrate(curationIds)
    for (const item of hydrated.items) {
      availableCount += 1
      if (format === 'csv') {
        yield csvRow(item)
        continue
      }
      const line = encodeRecord({ record_type: 'item', item: publicItem(item) })
      digest.update(line)
      yield line
    }
    for (const unavailable of hydrated.unavailable) {
      unavailableCount += 1
      unavailableReasons[unavailable.reason] = (unavailableReasons[unavailable.reason] ?? 0) + 1
    }
    processed += curationIds.length
    onProgress({ processed, availableCount, unavailableCount, batches })
  }

  if (format === 'ndjson') {
    yield encodeRecord({
      record_type: 'footer',
      selected_count: manifest.capturedCount,
      available_count: availableCount,
      unavailable_count: unavailableCount,
      unavailable_reasons: unavailableReasons,
      sha256: digest.digest('hex'),
    })
  }
}

/** The export allowlist: exactly the public hydration fields, nothing else. */
function publicItem(item: HydratedRecord): Record<string, unknown> {
  return { curation_id: item.curationId, entity_id: item.entityId, name: item.name, curation_note: item.curationNote }
}

function csvRow(item: HydratedRecord): Uint8Array {
  return new TextEncoder().encode([
    csvField(item.curationId), csvField(item.entityId), csvField(item.name), csvField(item.curationNote),
  ].join(',') + '\n')
}

export interface ExportRunDependencies {
  store: ArtifactStore
  client?: ExportHydrationClient
  signedUrlTtlSeconds?: number
}

/**
 * Worker core: claims the export record (CAS/fencing), streams allowlisted
 * records to private object storage, persists `StoredArtifact` fields only
 * after the upload completed and returns a short-lived private download URL in
 * the terminal `complete` state. Retries re-claim the same record and never
 * duplicate rows because the manifest items are deduplicated by their unique
 * index.
 */
export async function runExportSelection(
  payload: Payload,
  exportId: string,
  owner: string,
  dependencies: ExportRunDependencies,
): Promise<ExportRunResult | null> {
  const exportsModel = modelFor(payload, 'collection-exports')
  const claimed = await claimExport(payload, exportId, owner)
  if (!claimed) return null
  const { record } = claimed
  const lease = claimed.lease
  try {
    const client = dependencies.client ?? new FastApiExportHydrationClient()
    await client.introspectAdmin(record.actorId)
    const manifest = await loadReadyManifest(payload, record.selectionId, record.actorId)
    const contentType = record.format === 'ndjson' ? 'application/x-ndjson' : 'text/csv'
    const key = `${record.selectionId}/${record.id}.${record.format}`

    const progress: Record<string, number> = {}
    const onProgress = (partial: Record<string, number>): void => {
      Object.assign(progress, partial)
      exportsModel.updateOne(
        { _id: record.id, status: 'running', leaseOwner: lease.owner, fencingToken: lease.fencingToken },
        { $set: { progress, updatedAt: new Date() } },
      ).catch(() => undefined)
    }

    const body = writeSelectionStream({
      payload, format: record.format, manifest, client, onProgress,
    })
    const artifact = await dependencies.store.put({ key, contentType, expiresAt: record.expiresAt, body })

    const done = await exportsModel.findOneAndUpdate(
      { _id: record.id, status: 'running', leaseOwner: lease.owner, fencingToken: lease.fencingToken },
      { $set: { status: 'complete', key: artifact.key, contentType: artifact.contentType, sha256: artifact.sha256, progress, leaseExpiresAt: null, updatedAt: new Date() } },
      { new: true, lean: true },
    )
    if (!done) throw new AdminHttpError(409, 'conflict')

    const downloadUrl = await dependencies.store.readUrl(artifact)
    const ttlSeconds = dependencies.signedUrlTtlSeconds ?? readArtifactStorageEnv().signedUrlTtlSeconds
    return {
      exportId: record.id,
      status: 'complete',
      downloadUrl,
      downloadExpiresAt: new Date(Date.now() + ttlSeconds * 1000),
    }
  } catch (error) {
    await exportsModel.updateOne(
      { _id: record.id, status: 'running', leaseOwner: lease.owner, fencingToken: lease.fencingToken },
      { $set: { leaseExpiresAt: new Date(), updatedAt: new Date() } },
    )
    throw error
  }
}
