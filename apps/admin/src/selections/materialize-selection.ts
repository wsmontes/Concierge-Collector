import { createHash } from 'node:crypto'
import { Types, type ClientSession, type Model } from 'mongoose'
import type { Payload } from 'payload'
import { AdminHttpError } from '../http/errors'
import type { CreateSelectionCommand, SelectionCatalogClient, SelectionLease, SelectionManifestRecord } from './types'
import { FastApiSelectionCatalogClient } from './catalog-client'

type DocumentModel = Model<Record<string, unknown>>
const LEASE_MS = 60_000
const EXPLICIT_LIMIT = 500
const EXCLUSION_LIMIT = 5_000

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

export function asRecord(document: unknown): SelectionManifestRecord {
  const value = document as Record<string, unknown>
  return {
    ...value,
    id: String(value.id ?? value._id),
    checkpointCursor: (value.checkpointCursor as string | null | undefined) ?? null,
    excludedIds: Array.isArray(value.excludedIds) ? value.excludedIds.filter((id): id is string => typeof id === 'string') : [],
    filters: (value.filters as SelectionManifestRecord['filters']) ?? null,
    manifestHash: (value.manifestHash as string | null | undefined) ?? null,
    payloadJobId: (value.payloadJobId as string | null | undefined) ?? null,
    scanToken: (value.scanToken as string | null | undefined) ?? null,
    skippedReasons: (value.skippedReasons as Record<string, number> | undefined) ?? {},
  } as SelectionManifestRecord
}

function ids(value: string[] | undefined, limit: number, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 && label === 'curation IDs') throw new AdminHttpError(400, 'invalid_request')
  const normalized = [...new Set(value.map((id) => typeof id === 'string' ? id.trim() : '').filter(Boolean))].sort()
  if ((label === 'curation IDs' && !normalized.length) || normalized.length > limit || normalized.some((id) => id.includes('\0') || id.includes('\n'))) {
    throw new AdminHttpError(400, 'invalid_request')
  }
  return normalized
}

function requestHash(command: CreateSelectionCommand, curationIds: string[], excludedIds: string[]): string {
  return createHash('sha256').update(JSON.stringify({
    actorId: command.actorId, curationIds, excludedIds, filters: command.filters ?? {}, mode: command.mode,
  })).digest('hex')
}

async function existing(manifests: DocumentModel, actorId: string, idempotencyKey: string, hash: string): Promise<SelectionManifestRecord | null> {
  const document = await manifests.findOne({ actorId, idempotencyKey }).lean()
  if (!document) return null
  const selection = asRecord(document)
  if (selection.requestHash !== hash) throw new AdminHttpError(409, 'idempotency_conflict')
  return selection
}

async function recoverIdempotencyRace(
  manifests: DocumentModel,
  actorId: string,
  idempotencyKey: string,
  hash: string,
  persist: () => Promise<void>,
): Promise<SelectionManifestRecord | null> {
  try {
    await persist()
    return null
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000) {
      const winner = await existing(manifests, actorId, idempotencyKey, hash)
      if (winner) return winner
    }
    throw error
  }
}

/** Creates an immutable explicit manifest or queues a high-water materialization. */
export async function createSelection(
  payload: Payload,
  command: CreateSelectionCommand,
  catalog: SelectionCatalogClient = new FastApiSelectionCatalogClient(),
): Promise<SelectionManifestRecord> {
  if (!command.actorId || !command.idempotencyKey || !command.requestId) throw new AdminHttpError(400, 'invalid_request')
  if (command.mode !== 'explicit' && command.mode !== 'all_matching') throw new AdminHttpError(400, 'invalid_request')
  const curationIds = command.mode === 'explicit' ? ids(command.curationIds, EXPLICIT_LIMIT, 'curation IDs') : []
  const excludedIds = command.mode === 'all_matching' ? (command.excludedIds ? ids(command.excludedIds, EXCLUSION_LIMIT, 'exclusions') : []) : []
  if (command.mode === 'all_matching' && (!command.filters || command.curationIds)) throw new AdminHttpError(400, 'invalid_request')
  const hash = requestHash(command, curationIds, excludedIds)
  const manifests = modelFor(payload, 'selection-manifests')
  const already = await existing(manifests, command.actorId, command.idempotencyKey, hash)
  if (already) return already

  await catalog.introspectAdmin(command.actorId)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const id = new Types.ObjectId().toHexString()
  const items = modelFor(payload, 'selection-manifest-items')
  const jobs = modelFor(payload, 'payload-jobs')
  let document: Record<string, unknown>
  if (command.mode === 'explicit') {
    const resolved = await catalog.resolveCurations(curationIds, command.actorId)
    const selected = [...new Set(resolved.eligibleIds)].sort()
    const manifest = await hashSelectionManifestIds((async function* () { yield* selected })())
    document = {
      _id: id, actorId: command.actorId, mode: 'explicit', excludedIds: [], candidateCount: curationIds.length,
      capturedCount: manifest.count, skippedCount: resolved.rejected.length,
      skippedReasons: resolved.rejected.reduce<Record<string, number>>((counts, rejected) => ({ ...counts, [rejected.reason]: (counts[rejected.reason] ?? 0) + 1 }), {}),
      manifestHash: manifest.sha256, status: 'ready', fencingToken: 0, idempotencyKey: command.idempotencyKey,
    requestHash: hash, requestId: command.requestId, expiresAt, createdAt: now, updatedAt: now,
    }
    const raced = await recoverIdempotencyRace(manifests, command.actorId, command.idempotencyKey, hash, () => inTransaction(payload, async (session) => {
      await manifests.create([document], { session })
      if (selected.length) await items.insertMany(
        selected.map((curationId) => ({ selectionId: id, curationId, expiresAt, createdAt: now })), { session },
      )
    }))
    if (raced) return raced
  } else {
    const scan = await catalog.startScan(command.filters!, command.actorId)
    const payloadJobId = new Types.ObjectId().toHexString()
    document = {
      _id: id, actorId: command.actorId, mode: 'all_matching', filters: command.filters, excludedIds,
      scanToken: scan.scanToken, checkpointCursor: null, scanComplete: false, candidateCount: 0, capturedCount: 0, skippedCount: 0,
      skippedReasons: {}, status: 'queued', fencingToken: 0, idempotencyKey: command.idempotencyKey,
      requestHash: hash, requestId: command.requestId, payloadJobId, expiresAt, createdAt: now, updatedAt: now,
    }
    const raced = await recoverIdempotencyRace(manifests, command.actorId, command.idempotencyKey, hash, () => inTransaction(payload, async (session) => {
      await manifests.create([document], { session })
      await jobs.create([{
        _id: payloadJobId, input: { selectionId: id }, taskSlug: 'materialize-selection', queue: 'selection-materialization',
        processing: false, totalTried: 0, hasError: false, createdAt: now, updatedAt: now,
      }], { session })
    }))
    if (raced) return raced
  }
  return asRecord(document)
}

async function claim(payload: Payload, selectionId: string, owner: string): Promise<{ lease: SelectionLease; selection: SelectionManifestRecord } | null> {
  const manifests = modelFor(payload, 'selection-manifests')
  const now = new Date()
  const document = await manifests.findOneAndUpdate(
    { _id: selectionId, mode: 'all_matching', status: { $in: ['queued', 'materializing'] }, $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lt: now } }, { leaseOwner: owner }] },
    { $set: { status: 'materializing', leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: now }, $inc: { fencingToken: 1 } },
    { new: true, lean: true },
  )
  if (!document) return null
  const selection = asRecord(document)
  return { selection, lease: { owner, fencingToken: selection.fencingToken } }
}

async function manifestItemHash(items: DocumentModel, selectionId: string) {
  async function* rows() {
    for await (const row of items.find({ selectionId }).sort({ curationId: 1 }).cursor()) yield String(row.curationId)
  }
  return hashSelectionManifestIds(rows())
}

/** Resumable, fenced high-water materialization. Cursor retries are safe due to the unique item index. */
export async function materializeSelection(
  payload: Payload,
  selectionId: string,
  owner: string,
  catalog: SelectionCatalogClient = new FastApiSelectionCatalogClient(),
): Promise<SelectionManifestRecord | null> {
  const claimed = await claim(payload, selectionId, owner)
  if (!claimed) return null
  const manifests = modelFor(payload, 'selection-manifests')
  const items = modelFor(payload, 'selection-manifest-items')
  let { selection } = claimed
  const { lease } = claimed
  try {
    await catalog.introspectAdmin(selection.actorId)
    while (selection.status === 'materializing' && !selection.scanComplete) {
      const page = await catalog.scanPage({ actorId: selection.actorId, scanToken: selection.scanToken!, cursor: selection.checkpointCursor, limit: 500 })
      const accepted = page.items.map((row) => row.curation_id).filter((id) => !selection.excludedIds.includes(id))
      if (accepted.length) await items.bulkWrite(accepted.map((curationId) => ({
        updateOne: { filter: { selectionId, curationId }, update: { $setOnInsert: { selectionId, curationId, expiresAt: selection.expiresAt, createdAt: new Date() } }, upsert: true },
      })), { ordered: false })
      const checkpoint = await manifests.findOneAndUpdate(
        { _id: selectionId, status: 'materializing', leaseOwner: lease.owner, fencingToken: lease.fencingToken, checkpointCursor: selection.checkpointCursor },
        { $set: { checkpointCursor: page.next_cursor, scanComplete: page.next_cursor === null, updatedAt: new Date() }, $inc: { candidateCount: page.items.length } },
        { new: true, lean: true },
      )
      if (!checkpoint) throw new AdminHttpError(409, 'conflict')
      selection = asRecord(checkpoint)
      if (page.next_cursor === null) break
      await catalog.introspectAdmin(selection.actorId)
    }
    const hashed = await manifestItemHash(items, selectionId)
    const ready = await manifests.findOneAndUpdate(
      { _id: selectionId, status: 'materializing', leaseOwner: lease.owner, fencingToken: lease.fencingToken },
      { $set: { status: 'ready', capturedCount: hashed.count, skippedCount: Math.max(0, selection.candidateCount - hashed.count), manifestHash: hashed.sha256, leaseExpiresAt: null, updatedAt: new Date() } },
      { new: true, lean: true },
    )
    if (!ready) throw new AdminHttpError(409, 'conflict')
    return asRecord(ready)
  } catch (error) {
    await manifests.updateOne(
      { _id: selectionId, status: 'materializing', leaseOwner: lease.owner, fencingToken: lease.fencingToken },
      { $set: { leaseExpiresAt: new Date(), updatedAt: new Date() } },
    )
    throw error
  }
}

/**
 * Canonical, incremental integrity digest for a ready manifest.
 * Callers must feed the database cursor ordered by `curationId`.
 */
export async function hashSelectionManifestIds(ids: AsyncIterable<string>): Promise<{ count: number; sha256: string }> {
  const digest = createHash('sha256').update('concierge.selection-manifest.v1\0')
  let count = 0
  let previous: string | null = null
  for await (const id of ids) {
    if (!id || id.includes('\0') || id.includes('\n')) throw new Error('manifest IDs must be canonical text')
    if (previous !== null && id <= previous) throw new Error('manifest IDs must be strictly sorted and unique')
    digest.update(id, 'utf8').update('\n')
    previous = id
    count += 1
  }
  return { count, sha256: digest.digest('hex') }
}
