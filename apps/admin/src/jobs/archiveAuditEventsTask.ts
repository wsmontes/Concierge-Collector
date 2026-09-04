'use server'

import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { ClientSession, Model } from 'mongoose'
import type { Payload, TaskConfig } from 'payload'
import { readRetentionInt } from '../retention-policy'
import type { ArtifactStore, StoredArtifact } from '../storage/artifact-store'
import { createS3ArtifactStore } from '../storage/s3-artifact-store'

type DocumentModel = Model<Record<string, unknown>>

const DEFAULT_AUDIT_RETENTION_DAYS = 365
const DEFAULT_AUDIT_ARCHIVE_BATCH_SIZE = 1000
const CONTENT_TYPE = 'application/x-ndjson+gzip'

export interface AuditArchiveOptions {
  retentionDays?: number
  batchSize?: number
}

export interface AuditArchiveSummary {
  scanned: number
  archived: number
  preserved: number
}

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function iso(value: unknown): string | null {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      output[key] = stableValue((value as Record<string, unknown>)[key])
    }
    return output
  }
  return value
}

function archiveRecord(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.id ?? row._id),
    eventKey: row.eventKey,
    eventType: row.eventType,
    actorId: row.actorId,
    requestId: row.requestId,
    collectionId: row.collectionId ?? null,
    applicationId: row.applicationId ?? null,
    credentialId: row.credentialId ?? null,
    operationId: row.operationId ?? null,
    publicationJobId: row.publicationJobId ?? null,
    beforeRevision: row.beforeRevision ?? null,
    afterRevision: row.afterRevision ?? null,
    metadata: stableValue(row.metadata ?? {}),
    createdAt: iso(row.createdAt),
  }
}

function encodedBatch(events: Record<string, unknown>[]): { ndjson: Buffer; gzip: Buffer; sha256: string; batchKey: string } {
  const ndjson = Buffer.from(events.map((row) => JSON.stringify(archiveRecord(row))).join('\n') + '\n', 'utf8')
  const gzip = gzipSync(ndjson, { level: 9 })
  const sha256 = createHash('sha256').update(gzip).digest('hex')
  const first = String(events[0]?.id ?? events[0]?._id ?? '')
  const last = String(events.at(-1)?.id ?? events.at(-1)?._id ?? '')
  const batchKey = createHash('sha256').update(`${first}\n${last}\n${sha256}`).digest('hex')
  return { ndjson, gzip, sha256, batchKey }
}

function manifestMatches(
  manifest: Record<string, unknown> | null,
  stored: StoredArtifact,
  encoded: { sha256: string; batchKey: string },
  ids: unknown[],
): boolean {
  if (!manifest || ids.length === 0) return false
  const artifactKey = typeof manifest.artifactKey === 'string' ? manifest.artifactKey : ''
  const expectedSuffix = `audit/${encoded.batchKey}.ndjson.gz`
  return manifest.batchKey === encoded.batchKey
    && artifactKey === stored.key
    && (artifactKey === expectedSuffix || artifactKey.endsWith(`/${expectedSuffix}`))
    && manifest.contentType === CONTENT_TYPE
    && manifest.sha256 === encoded.sha256
    && stored.contentType === CONTENT_TYPE
    && stored.sha256 === encoded.sha256
    && Number(manifest.eventCount) === ids.length
    && String(manifest.firstEventId) === String(ids[0])
    && String(manifest.lastEventId) === String(ids.at(-1))
}

async function* oneBuffer(value: Buffer): AsyncIterable<Uint8Array> {
  yield value
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

/**
 * Archives immutable Admin audit rows to private object storage before removing
 * them from the hot CMS database. The object key and bytes are deterministic,
 * so a failed Mongo transaction can safely retry the same upload.
 *
 * After upload, manifest persistence, manifest verification, source purge and
 * the completion event are one Mongo transaction. A committed transaction
 * therefore proves both that the private artifact is durably and correctly
 * referenced and that every selected hot row is gone before
 * `audit.archive.completed` becomes visible.
 */
export async function archiveAuditEvents(
  payload: Payload,
  store: ArtifactStore | null,
  now = new Date(),
  options: AuditArchiveOptions = {},
): Promise<AuditArchiveSummary> {
  const retentionDays = options.retentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS
  const batchSize = options.batchSize ?? DEFAULT_AUDIT_ARCHIVE_BATCH_SIZE
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  const eventsModel = modelFor(payload, 'audit-events')
  const manifests = modelFor(payload, 'audit-archive-manifests')

  const events = await eventsModel.find({ createdAt: { $lt: cutoff } })
    .sort({ createdAt: 1, _id: 1 })
    .limit(batchSize)
    .lean() as Record<string, unknown>[]

  if (events.length === 0) return { scanned: 0, archived: 0, preserved: 0 }

  const ids = events.map((row) => row.id ?? row._id).filter((id) => id !== null && id !== undefined)
  if (ids.length !== events.length) return { scanned: events.length, archived: 0, preserved: events.length }

  const encoded = encodedBatch(events)
  const existing = await manifests.findOne({ batchKey: encoded.batchKey }).lean() as Record<string, unknown> | null
  let stored: StoredArtifact

  try {
    if (existing) {
      stored = {
        key: String(existing.artifactKey),
        contentType: String(existing.contentType),
        sha256: String(existing.sha256),
      }
      if (!manifestMatches(existing, stored, encoded, ids)) {
        return { scanned: events.length, archived: 0, preserved: events.length }
      }
    } else {
      const resolvedStore = store ?? createS3ArtifactStore()
      stored = await resolvedStore.put({
        key: `audit/${encoded.batchKey}.ndjson.gz`,
        contentType: CONTENT_TYPE,
        body: oneBuffer(encoded.gzip),
      })
      if (stored.sha256 !== encoded.sha256 || stored.contentType !== CONTENT_TYPE) {
        return { scanned: events.length, archived: 0, preserved: events.length }
      }
    }
  } catch {
    return { scanned: events.length, archived: 0, preserved: events.length }
  }

  const completionKey = `audit-archive:${encoded.batchKey}:completed`
  try {
    await inTransaction(payload, async (session) => {
      await manifests.updateOne(
        { batchKey: encoded.batchKey },
        {
          $setOnInsert: {
            batchKey: encoded.batchKey,
            artifactKey: stored.key,
            contentType: stored.contentType,
            sha256: stored.sha256,
            eventCount: events.length,
            firstEventId: String(ids[0]),
            lastEventId: String(ids.at(-1)),
            oldestCreatedAt: new Date(String(events[0].createdAt)),
            newestCreatedAt: new Date(String(events.at(-1)?.createdAt)),
            archivedAt: now,
          },
        },
        { upsert: true, session },
      )

      const persistedManifest = await manifests.findOne({ batchKey: encoded.batchKey })
        .session(session)
        .lean() as Record<string, unknown> | null
      if (!manifestMatches(persistedManifest, stored, encoded, ids)) {
        throw new Error('audit archive manifest mismatch')
      }

      await eventsModel.deleteMany({ _id: { $in: ids } }, { session })
      const remaining = await eventsModel.countDocuments({ _id: { $in: ids } }).session(session)
      if (remaining !== 0) throw new Error('audit source purge incomplete')

      await eventsModel.updateOne(
        { eventKey: completionKey },
        {
          $setOnInsert: {
            eventKey: completionKey,
            eventType: 'audit.archive.completed',
            actorId: 'system:audit-archive',
            requestId: `maintenance:${encoded.batchKey}`,
            metadata: {
              batchKey: encoded.batchKey,
              artifactKey: stored.key,
              eventCount: events.length,
              sha256: stored.sha256,
            },
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true, session },
      )
    })
  } catch {
    // The artifact may already exist, but the deterministic key/content make it
    // safe to retry. Mongo transaction rollback preserves every hot source row.
    return { scanned: events.length, archived: 0, preserved: events.length }
  }

  return { scanned: events.length, archived: events.length, preserved: 0 }
}

export const archiveAuditEventsTask: TaskConfig<{
  input: Record<string, never>
  output: AuditArchiveSummary
}> = {
  slug: 'archive-audit-events',
  inputSchema: [],
  outputSchema: [
    { name: 'scanned', type: 'number', required: true },
    { name: 'archived', type: 'number', required: true },
    { name: 'preserved', type: 'number', required: true },
  ],
  schedule: [{ cron: '43 3 * * *', queue: 'maintenance' }],
  handler: async ({ req }) => ({
    output: await archiveAuditEvents(req.payload, null, new Date(), {
      retentionDays: readRetentionInt('CMS_AUDIT_RETENTION_DAYS', DEFAULT_AUDIT_RETENTION_DAYS),
      batchSize: positiveInt('CMS_AUDIT_ARCHIVE_BATCH_SIZE', DEFAULT_AUDIT_ARCHIVE_BATCH_SIZE),
    }),
  }),
}
