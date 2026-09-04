import { createHash } from 'node:crypto'
import type { ArtifactPutRequest, ArtifactStore, StoredArtifact } from '../../src/storage/artifact-store'

export interface CapturedPut extends ArtifactPutRequest {
  artifact: StoredArtifact
  capturedUtf8: string
}

/**
 * In-memory ArtifactStore for integration tests. It mirrors the S3 adapter's
 * contract: the body is consumed exactly once, the SHA-256 is computed over
 * the bytes actually streamed, `readUrl` respects the caller-requested TTL,
 * and confirmed deletes are observable through `deleteCalls`.
 */
export class FakeArtifactStore implements ArtifactStore {
  putCalls: CapturedPut[] = []
  readUrlCalls: Array<{ artifact: StoredArtifact; ttlSeconds: number }> = []
  deleteCalls: string[] = []

  async put(request: ArtifactPutRequest): Promise<StoredArtifact> {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of request.body) {
      const buffer = Buffer.from(chunk)
      chunks.push(buffer)
      bytes += buffer.length
    }
    const body = Buffer.concat(chunks, bytes)
    const artifact: StoredArtifact = {
      key: `fake-bucket/private/${request.key}`,
      contentType: request.contentType,
      sha256: createHash('sha256').update(body).digest('hex'),
      expiresAt: request.expiresAt,
    }
    this.putCalls.push({ ...request, artifact, capturedUtf8: body.toString('utf8') })
    return artifact
  }

  async readUrl(artifact: StoredArtifact, ttlSeconds = 300): Promise<string> {
    this.readUrlCalls.push({ artifact, ttlSeconds })
    return `https://fake-store.invalid/private/${artifact.key}?X-Amz-Expires=${ttlSeconds}&X-Amz-Signature=deadbeef&X-Amz-Credential=fake/private`
  }

  async delete(key: string): Promise<void> {
    this.deleteCalls.push(key)
  }
}
