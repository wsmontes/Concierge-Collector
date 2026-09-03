import type { Endpoint, PayloadRequest } from 'payload'
import type { Model } from 'mongoose'
import { readArtifactStorageEnv } from '../../env'
import { asRecord, createExport } from '../../exports/export-selection'
import type { ExportRecord } from '../../exports/types'
import { AdminHttpError, adminErrorResponse } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'
import { retainSelectionForAudit } from '../../selections/retention'
import { createS3ArtifactStore } from '../../storage/s3-artifact-store'
import type { StoredArtifact } from '../../storage/artifact-store'

type DocumentModel = Model<Record<string, unknown>>

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as Record<string, unknown>
  } catch {
    throw new AdminHttpError(400, 'invalid_request')
  }
}

function exportId(request: PayloadRequest): string {
  const id = request.routeParams?.id
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw new AdminHttpError(404, 'not_found')
  return id
}

function selectionId(request: PayloadRequest): string {
  const id = request.routeParams?.selectionId
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw new AdminHttpError(404, 'not_found')
  return id
}

function formatValue(value: Record<string, unknown>): 'ndjson' | 'csv' {
  if (Object.keys(value).some((key) => key !== 'format')) throw new AdminHttpError(400, 'invalid_request')
  if (value.format !== 'ndjson' && value.format !== 'csv') throw new AdminHttpError(400, 'invalid_request')
  return value.format
}

function modelFor(request: PayloadRequest): DocumentModel {
  const model = request.payload.db.collections['collection-exports']
  if (!model) throw new Error('Missing collection-exports model')
  return model as unknown as DocumentModel
}

function publicExport(value: ExportRecord, download?: { downloadUrl: string; downloadExpiresAt: Date }): Record<string, unknown> {
  return {
    id: value.id,
    selectionId: value.selectionId,
    format: value.format,
    status: value.status,
    progress: value.progress,
    sha256: value.status === 'complete' ? value.sha256 : null,
    ...(download ? { downloadUrl: download.downloadUrl, downloadExpiresAt: download.downloadExpiresAt } : {}),
  }
}

/** One export attempt is private to the live admin actor; URLs are short-lived. */
export function exportEndpoints(): Endpoint[] {
  return [
    {
      method: 'post', path: '/admin/v1/selections/:selectionId/exports',
      handler: (request: PayloadRequest) => withAdmin(async (adminRequest, actor) => {
        try {
          const idempotencyKey = adminRequest.headers.get('idempotency-key')?.trim()
          const requestId = adminRequest.headers.get('x-request-id')?.trim()
          if (!idempotencyKey || !requestId) throw new AdminHttpError(400, 'invalid_request')
          const format = formatValue(await body(adminRequest))
          // Capture before createExport's validity check. If the selection
          // crosses its expiry millisecond immediately after the export intent
          // commits, this timestamp still proves it was valid when consumed.
          const consumedAt = new Date()
          // Fail closed when export storage is not configured for this service.
          const artifactTtlSeconds = readArtifactStorageEnv().artifactTtlSeconds
          const selectedId = selectionId(request)
          const record = await createExport(request.payload, {
            selectionId: selectedId,
            actorId: actor.user_id,
            format,
            idempotencyKey,
            requestId,
          }, undefined, { artifactTtlSeconds })
          await retainSelectionForAudit(request.payload, {
            selectionId: selectedId,
            actorId: actor.user_id,
            now: consumedAt,
          })
          return Response.json(publicExport(record), { status: 202 })
        } catch (error) { return adminErrorResponse(error) }
      })(request as unknown as Request),
    },
    {
      method: 'get', path: '/admin/v1/exports/:id',
      handler: (request: PayloadRequest) => withAdmin(async (_adminRequest, actor) => {
        try {
          const document = await modelFor(request).findOne({ _id: exportId(request), actorId: actor.user_id }).lean()
          if (!document) throw new AdminHttpError(404, 'not_found')
          const record = asRecord(document)
          if (record.status !== 'complete') {
            return Response.json(publicExport(record))
          }
          // A fresh short-lived URL per read; never a permanent public URL.
          const env = readArtifactStorageEnv()
          const store = createS3ArtifactStore(env)
          const artifact: StoredArtifact = {
            key: record.key ?? '', contentType: record.contentType ?? '', sha256: record.sha256 ?? '', expiresAt: record.expiresAt,
          }
          if (!artifact.key) throw new AdminHttpError(503, 'service_unavailable')
          const downloadUrl = await store.readUrl(artifact)
          return Response.json(publicExport(record, {
            downloadUrl,
            downloadExpiresAt: new Date(Date.now() + env.signedUrlTtlSeconds * 1000),
          }))
        } catch (error) { return adminErrorResponse(error) }
      })(request as unknown as Request),
    },
  ]
}
