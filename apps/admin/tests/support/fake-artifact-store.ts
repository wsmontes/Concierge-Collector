import { createHash } from 'node:crypto'
import type { ArtifactPutRequest, ArtifactStore, StoredArtifact } from '../../src/storage/artifact-store'

export interface CapturedPut extends ArtifactPutRequest {
  artifact: StoredArtifact
  capturedUtf8: string
}

/**
 * In-memory ArtifactStore for integration tests. It mirrors the S3 adapter's
 * contract: the body is consumed exactly once, the SHA-256 is computed over
 * the bytes that were actually streamed, and it is only exposed after a
 * completed upload. `readUrl` returns a private-looking signed URL so tests
 * can assert the export never exposes `public-read` access.
 */
export class FakeArtifactStore implements ArtifactStore {
  putCalls: CapturedPut[] = []
  private sequence = 0

  async put(request: ArtifactPutRequest): Promise<StoredArtifact> {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of request.body) {
      const buffer = Buffer.from(chunk)
      chunks.push(buffer)
      bytes += buffer.length
    }
    const body = Buffer.concat(chunks, bytes)
    this.sequence += 1
    const artifact: StoredArtifact = {
      key: `fake-bucket/private/${request.key}`,
      contentType: request.contentType,
      sha256: createHash('sha256').update(body).digest('hex'),
      expiresAt: request.expiresAt,
    }
    this.putCalls.push({ ...request, artifact, capturedUtf8: body.toString('utf8') })
    return artifact
  }

  async readUrl(artifact: StoredArtifact): Promise<string> {
    return `https://fake-store.invalid/private/${artifact.key}?X-Amz-Expires=300&X-Amz-Signature=deadbeef&X-Amz-Credential=fake/private`
  }

  async delete(_key: string): Promise<void> {
    // No-op: purge is out of scope for v1 (record TTL + bucket lifecycle).
  }
}
