import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { readArtifactStorageEnv, type ArtifactStorageEnv } from '../env'
import { AdminHttpError } from '../http/errors'
import type { ArtifactPutRequest, ArtifactStore, StoredArtifact } from './artifact-store'

/**
 * S3-compatible private artifact store for selection exports.
 *
 * The client and environment are built lazily by `createS3ArtifactStore()` —
 * never at module import — so boot, unit tests and any deployment without
 * export storage stay unaffected. When S3 variables are absent the first
 * export operation fails closed with 503.
 *
 * Uploads stream through `@aws-sdk/lib-storage` with an async generator that
 * feeds the SHA-256 of the bytes actually sent. The digest is only persisted
 * after the multipart upload completes; the initial multipart metadata never
 * claims to know the final digest. No ACL is set: the bucket policy stays
 * private and reads happen only through short-lived presigned URLs.
 *
 * The principal bucket IAM policy is prefix-scoped to PutObject, GetObject,
 * AbortMultipartUpload, ListBucketMultipartUploads and DeleteObject.
 */
export function createS3ArtifactStore(env: ArtifactStorageEnv = readArtifactStorageEnv()): ArtifactStore {
  const client = new S3Client({
    region: env.region,
    endpoint: env.endpoint,
    forcePathStyle: env.forcePathStyle,
    credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
  })

  return {
    async put(input: ArtifactPutRequest): Promise<StoredArtifact> {
      const key = `${env.exportPrefix}/${input.key}`
      const digest = createHash('sha256')
      async function* hashingBody() {
        for await (const chunk of input.body) {
          digest.update(chunk)
          yield chunk
        }
      }
      await new Upload({
        client,
        params: {
          Bucket: env.bucket,
          Key: key,
          Body: Readable.from(hashingBody()),
          ContentType: input.contentType,
          // Bound the object lifecycle regardless of the CMS record TTL.
          Metadata: { expiresAt: input.expiresAt.toISOString() },
        },
      }).done() // no ACL: bucket policy remains private
      return { key, contentType: input.contentType, sha256: digest.digest('hex'), expiresAt: input.expiresAt }
    },

    async readUrl(artifact: StoredArtifact): Promise<string> {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: env.bucket, Key: artifact.key }), {
        expiresIn: env.signedUrlTtlSeconds,
      })
    },

    async delete(key: string): Promise<void> {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: env.bucket, Key: key }))
      } catch (error) {
        throw new AdminHttpError(503, 'service_unavailable')
      }
    },
  }
}
