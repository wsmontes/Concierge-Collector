/**
 * Private artifact storage boundary for CMS operational artifacts: selection
 * exports and long-lived audit archives. The S3 implementation lives in
 * `s3-artifact-store.ts`; tests substitute an in-memory fake. Uploads stream
 * from `AsyncIterable` so writers do not need whole artifacts in memory.
 */

export interface ArtifactPutRequest {
  /** Path inside the configured private prefix; the store composes the final object key. */
  key: string
  contentType: string
  /** Optional absolute lifecycle hint. Export artifacts set it; audit archives do not expire here. */
  expiresAt?: Date
  body: AsyncIterable<Uint8Array>
}

export interface StoredArtifact {
  /** Full object key as stored (including the store's private prefix). */
  key: string
  contentType: string
  /**
   * SHA-256 of the bytes that were actually sent, computed while streaming and
   * only exposed after the upload completed. Never known by multipart metadata
   * ahead of the final byte.
   */
  sha256: string
  expiresAt?: Date
}

export interface ArtifactStore {
  put(request: ArtifactPutRequest): Promise<StoredArtifact>
  /** Short-lived private read URL; only exposed by explicitly authorized routes. */
  readUrl(artifact: StoredArtifact): Promise<string>
  /**
   * Confirmed object purge boundary. Callers retain their CMS reference when
   * this operation fails so cleanup remains traceable and retryable.
   */
  delete(key: string): Promise<void>
}
