import type { Endpoint, PayloadRequest } from 'payload'
import type { Model } from 'mongoose'
import { AdminHttpError, adminErrorResponse } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'
import { normalizeCurationFilters } from '../../explorer/normalize-filters'
import { asRecord, createSelection } from '../../selections/materialize-selection'
import type { CreateSelectionCommand, SelectionManifestRecord } from '../../selections/types'

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

function command(value: Record<string, unknown>, request: PayloadRequest, actorId: string): CreateSelectionCommand {
  if (Object.keys(value).some((key) => !['mode', 'curation_ids', 'filters', 'excluded_ids'].includes(key))) throw new AdminHttpError(400, 'invalid_request')
  const idempotencyKey = request.headers.get('idempotency-key')?.trim()
  const requestId = request.headers.get('x-request-id')?.trim()
  if (!idempotencyKey || !requestId || (value.mode !== 'explicit' && value.mode !== 'all_matching')) throw new AdminHttpError(400, 'invalid_request')
  if (value.curation_ids !== undefined && (!Array.isArray(value.curation_ids) || value.curation_ids.some((id) => typeof id !== 'string'))) throw new AdminHttpError(400, 'invalid_request')
  if (value.excluded_ids !== undefined && (!Array.isArray(value.excluded_ids) || value.excluded_ids.some((id) => typeof id !== 'string'))) throw new AdminHttpError(400, 'invalid_request')
  if (value.filters !== undefined && (!value.filters || typeof value.filters !== 'object' || Array.isArray(value.filters))) throw new AdminHttpError(400, 'invalid_request')
  return {
    actorId, idempotencyKey, requestId, mode: value.mode,
    curationIds: value.curation_ids as string[] | undefined,
    excludedIds: value.excluded_ids as string[] | undefined,
    filters: value.filters === undefined ? undefined : normalizeCurationFilters(value.filters as Record<string, unknown>),
  }
}

function modelFor(request: PayloadRequest): DocumentModel {
  const model = request.payload.db.collections['selection-manifests']
  if (!model) throw new Error('Missing selection manifest model')
  return model as unknown as DocumentModel
}

function selectionId(request: PayloadRequest): string {
  const id = request.routeParams?.id
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw new AdminHttpError(404, 'not_found')
  return id
}

function publicSelection(value: SelectionManifestRecord) {
  return {
    id: value.id,
    mode: value.mode,
    status: value.status,
    candidateCount: value.candidateCount,
    capturedCount: value.capturedCount,
    skippedCount: value.skippedCount,
    manifestHash: value.manifestHash,
    expiresAt: value.expiresAt,
  }
}

/** Selection intents are private to the live admin actor and never expose worker leases/job ids. */
export function selectionEndpoints(): Endpoint[] {
  return [
    {
      method: 'post', path: '/admin/v1/selections',
      handler: (request: PayloadRequest) => withAdmin(async (adminRequest, actor) => {
        try {
          return Response.json(publicSelection(await createSelection(request.payload, command(await body(adminRequest), request, actor.user_id))), { status: 202 })
        } catch (error) { return adminErrorResponse(error) }
      })(request as unknown as Request),
    },
    {
      method: 'get', path: '/admin/v1/selections/:id',
      handler: (request: PayloadRequest) => withAdmin(async (_adminRequest, actor) => {
        try {
          const selection = await modelFor(request).findOne({ _id: selectionId(request), actorId: actor.user_id }).lean()
          if (!selection) throw new AdminHttpError(404, 'not_found')
          if (new Date(String(selection.expiresAt)).getTime() <= Date.now()) throw new AdminHttpError(410, 'selection_expired')
          return Response.json(publicSelection(asRecord(selection)))
        } catch (error) { return adminErrorResponse(error) }
      })(request as unknown as Request),
    },
  ]
}