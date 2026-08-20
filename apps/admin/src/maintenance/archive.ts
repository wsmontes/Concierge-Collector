import { gzipSync } from 'node:zlib'
import { createHash, randomUUID } from 'node:crypto'

export interface ArchiveManifest {
  archiveKey: string
  kind: 'audit_events' | 'operation_items'
  sourceCollection: string
  objectKey: string
  sha256: string
  count: number
  oldestCreatedAt: string | null
  newestCreatedAt: string | null
  archivedAt: string
}

interface ArchiveDocument {
  _id: unknown
  createdAt?: Date | string | null
  [key: string]: unknown
}

export interface ArchiveBatchInput {
  kind: ArchiveManifest['kind']
  sourceCollection: string
  docs: ArchiveDocument[]
  now: Date
  put(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<{ key: string; sha256: string }>
  persistManifestAndDelete(input: { manifest: ArchiveManifest; ids: unknown[] }): Promise<void>
}

function createdAtMillis(value: ArchiveDocument['createdAt']): number | null {
  if (!value) return null
  const millis = new Date(value).getTime()
  return Number.isFinite(millis) ? millis : null
}

function canonicalLine(document: ArchiveDocument): string {
  // Mongo ObjectIds and Dates implement JSON representations; the archive is
  // private evidence, not an API DTO. Never stringify request headers/secrets.
  return JSON.stringify(document)
}

/**
 * Archive one bounded batch. Upload completes first; only then can the caller
 * atomically persist the manifest and delete the exact source IDs. A storage
 * failure therefore cannot cause source-data loss.
 */
export async function archiveBatch(input: ArchiveBatchInput): Promise<ArchiveManifest> {
  if (!input.docs.length) throw new Error('archiveBatch requires at least one document')
  const ids = input.docs.map((doc) => doc._id)
  if (ids.some((id) => id === undefined || id === null)) throw new Error('archive document missing _id')

  const ndjson = `${input.docs.map(canonicalLine).join('\n')}\n`
  const compressed = gzipSync(Buffer.from(ndjson, 'utf8'), { level: 9 })
  const suffix = randomUUID()
  const key = `retention/${input.kind}/${input.now.toISOString().slice(0, 10)}/${suffix}.ndjson.gz`
  const stored = await input.put({ key, bytes: compressed, contentType: 'application/x-ndjson+gzip' })
  if (!/^[a-f0-9]{64}$/i.test(stored.sha256)) throw new Error('archive store returned invalid sha256')

  // Verify what was sent locally as well. Stores may calculate the digest
  // while streaming; disagreement is a hard failure and sources stay intact.
  const localSha = createHash('sha256').update(compressed).digest('hex')
  if (localSha !== stored.sha256.toLowerCase()) throw new Error('archive sha256 verification failed')

  const timestamps = input.docs.map((doc) => createdAtMillis(doc.createdAt)).filter((value): value is number => value !== null)
  const manifest: ArchiveManifest = {
    archiveKey: `${input.kind}:${localSha}`,
    kind: input.kind,
    sourceCollection: input.sourceCollection,
    objectKey: stored.key,
    sha256: localSha,
    count: input.docs.length,
    oldestCreatedAt: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
    newestCreatedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    archivedAt: input.now.toISOString(),
  }

  await input.persistManifestAndDelete({ manifest, ids })
  return manifest
}
