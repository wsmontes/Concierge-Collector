/**
 * Private artifact storage boundary for CMS exports (selection dumps, future
 * collection archives). The S3 implementation lives in `s3-artifact-store.ts`;
 * tests substitute an in-memory fake. Uploads stream from `AsyncIterable` so
 * writers never materialize whole artifacts in memory.
 */

export interface ArtifactPutRequest {
  /** Path inside the export prefix; the store composes the final object key. */
  key: string
  contentType: string
  /** Absolute expiry propagated to the artifact lifecycle (record TTL + metadata). */
  expiresAt: Date
  body: AsyncIterable<Uint8Array>
}

export interface StoredArtifact {
  /** Full object key as stored (including the store's export prefix). */
  key: string
  contentType: string
  /**
   * SHA-256 of the bytes that were actually sent, computed while streaming and
   * only exposed after the upload completed. Never known by multipart metadata
   * ahead of the final byte.
   */
  sha256: string
  expiresAt: Date
}

export interface ArtifactStore {
  put(request: ArtifactPutRequest): Promise<StoredArtifact>
  /** Short-lived private read URL; never a public-read URL. */
  readUrl(artifact: StoredArtifact): Promise<string>
  /**
   * Best-effort object purge. Bucket lifecycle rules remain the source of
   * truth for v1; the CMS record TTL (migration `export_artifact_ttl`) bounds
   * references even if the object outlives its signed URL.
   */
  delete(key: string): Promise<void>
}
