import type { Endpoint, PayloadRequest } from 'payload'
import type { Model } from 'mongoose'
import type { CmsIdentity } from '../../auth/fastapi-authz-client'
import { AdminHttpError } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'
import { authenticateAdminRequest } from '../../auth/authenticate-admin-request'
import { adminErrorResponse } from '../../http/errors'
import { readEnv } from '../../env'
import { cancelDraftOperation } from '../../operations/apply-draft-operation'
import { enqueueDraftOperation, enqueueMultiTarget, enqueueSelectionOperation } from '../../operations/enqueue'
import type { ParentOperationRecord, ParentSummary } from '../../operations/types'
import { assertOperationOwnedBy, publicStandaloneOperation } from '../../operations/visibility'

type DocumentModel = Model<Record<string, unknown>>

const TERMINAL = ['committed', 'completed', 'completed_with_skips', 'failed', 'cancelled', 'stale', 'conflicted', 'authorization_revoked']
const SUCCESS_TERMINAL = ['committed', 'completed', 'completed_with_skips']
const FAILED_TERMINAL = ['failed', 'cancelled', 'stale', 'conflicted', 'authorization_revoked']
const ACTIVE_LIST_LIMIT = 20

function routeId(request: PayloadRequest, key = 'id'): string {
  const id = request.routeParams?.[key]
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw new AdminHttpError(404, 'not_found')
  return id
}

function parseIfMatch(headers: Headers): number {
  const value = headers.get('if-match')?.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  if (!value || !/^\d+$/.test(value)) throw new AdminHttpError(412, 'precondition_failed')
  return Number(value)
}

type OperationBody = {
  action?: unknown
  curationIds?: unknown
  curation_ids?: unknown
  draft_revision?: unknown
  mode?: unknown
  selection_id?: unknown
  collectionIds?: unknown
  idempotencyKey?: unknown
}

async function body(request: Request): Promise<OperationBody> {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as OperationBody
  } catch {
    throw new AdminHttpError(400, 'invalid_request')
  }
}

function guard(handler: (request: PayloadRequest, actor: CmsIdentity) => Promise<Response>) {
  const guarded = withAdmin((request, actor) => handler(request as unknown as PayloadRequest, actor))
  return (request: PayloadRequest) => guarded(request as unknown as Request)
}

function operationModels(request: PayloadRequest) {
  const model = request.payload.db.collections['collection-operations']
  if (!model) throw new Error('Missing collection operations model')
  return model as unknown as DocumentModel
}

async function loadOperation(request: PayloadRequest, operationId: string): Promise<Record<string, unknown> | null> {
  const model = operationModels(request)
  const raw = model.collection as unknown as { findOne(query: Record<string, unknown>): Promise<Record<string, unknown> | null> }
  return await raw.findOne({ _id: operationId })
    ?? await model.findById(operationId).lean() as unknown as Record<string, unknown> | null
}

function readCollectorOrigin(request: PayloadRequest): boolean {
  const origin = request.headers.get('origin')
  return Boolean(origin && readEnv().collectorOrigins.includes(origin))
}

function cursorParam(request: PayloadRequest): string | null {
  const query = (request as { query?: Record<string, unknown> }).query
  const raw = typeof query?.cursor === 'string' ? query.cursor : null
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { after?: unknown }
    if (parsed && typeof parsed === 'object' && typeof parsed.after === 'string' && /^[a-f\d]{24}$/i.test(parsed.after)) return parsed.after
    throw new Error('invalid cursor')
  } catch {
    throw new AdminHttpError(400, 'invalid_request')
  }
}

function nextCursor(id: string): string {
  return Buffer.from(JSON.stringify({ after: id })).toString('base64url')
}

function idOf(value: Record<string, unknown>): string {
  return String(value.id ?? value._id)
}

function parentSummary(children: Array<Record<string, unknown>>): ParentSummary {
  return {
    active: children.filter((child) => !TERMINAL.includes(String(child.status))).length,
    completed: children.filter((child) => SUCCESS_TERMINAL.includes(String(child.status))).length,
    failed: children.filter((child) => FAILED_TERMINAL.includes(String(child.status))).length,
  }
}

function effectiveParentStatus(summary: ParentSummary): 'active' | 'completed' | 'failed' {
  if (summary.active > 0) return 'active'
  return summary.failed > 0 ? 'failed' : 'completed'
}

function sumProgress(children: Array<Record<string, unknown>>): Record<string, number> {
  const totals: Record<string, number> = { processed: 0, skipped: 0, failed: 0 }
  for (const child of children) {
    const progress = child.progress as Record<string, number> | undefined
    if (!progress) continue
    for (const key of ['processed', 'skipped', 'failed'] as const) totals[key] += Number(progress[key] ?? 0)
  }
  return totals
}

/** Loads an actor-owned parent and aggregates only that actor's children. */
async function parentWithSummary(
  request: PayloadRequest,
  parentId: string,
  actorId: string,
): Promise<{ parent: ParentOperationRecord; summary: ParentSummary; children: Array<Record<string, unknown>> } | null> {
  const operations = operationModels(request)
  const raw = operations.collection as unknown as { findOne(query: Record<string, unknown>): Promise<Record<string, unknown> | null> }
  const parent = await raw.findOne({ _id: parentId, actorId })
  if (!parent) return null
  const value = parent as Record<string, unknown>
  if (value.parentOperationId) return null
  const children = await operations.find({ parentOperationId: parentId, actorId }).lean() as Array<Record<string, unknown>>
  return { parent: { ...value, id: idOf(value) } as unknown as ParentOperationRecord, summary: parentSummary(children), children }
}

/** Command API for operations. Native Payload writes remain deny-by-default. */
export function operationEndpoints(): Endpoint[] {
  return [
    {
      method: 'post', path: '/admin/v1/collections/:id/draft/operations',
      handler: async (request: PayloadRequest) => {
        try {
          const value = await body(request as unknown as Request)
          if (Object.keys(value).some((key) => !['action', 'curationIds', 'curation_ids', 'draft_revision', 'mode', 'selection_id'].includes(key))) throw new AdminHttpError(400, 'invalid_request')
          if (value.curationIds !== undefined && value.curation_ids !== undefined) throw new AdminHttpError(400, 'invalid_request')
          const curationIds = value.curation_ids ?? value.curationIds
          const key = request.headers.get('idempotency-key')?.trim()
          const requestId = request.headers.get('x-request-id')?.trim()
          const baseDraftRevision = parseIfMatch(request.headers)
          if (!key || !requestId || (value.mode !== 'explicit' && value.mode !== 'selection') || (value.action !== 'add' && value.action !== 'remove') || !Number.isInteger(value.draft_revision) || value.draft_revision !== baseDraftRevision) {
            throw new AdminHttpError(400, 'invalid_request')
          }
          const selectionMode = value.mode === 'selection'
          if (selectionMode) {
            if (curationIds !== undefined || typeof value.selection_id !== 'string') throw new AdminHttpError(400, 'invalid_request')
            const actor = await authenticateAdminRequest(request as unknown as Request)
            const operation = await enqueueSelectionOperation(request.payload, {
              collectionId: routeId(request), selectionId: value.selection_id, action: value.action,
              idempotencyKey: key, actorId: actor.user_id, requestId,
            })
            return Response.json(publicStandaloneOperation(operation as unknown as Record<string, unknown>), { status: 202 })
          }
          if (!Array.isArray(curationIds)) throw new AdminHttpError(400, 'invalid_request')
          const actor = await authenticateAdminRequest(request as unknown as Request, {
            allowCollectorBearer: true,
            explicitCurationIds: curationIds as string[],
          })
          const operation = await enqueueDraftOperation(request.payload, {
            collectionId: routeId(request), action: value.action, curationIds,
            baseDraftRevision, idempotencyKey: key, actorId: actor.user_id, requestId,
          })
          return Response.json(publicStandaloneOperation(operation as unknown as Record<string, unknown>), { status: 202 })
        } catch (error) {
          return adminErrorResponse(error)
        }
      },
    },
    {
      method: 'post', path: '/admin/v1/selections/:selectionId/operations',
      handler: async (request: PayloadRequest) => {
        try {
          const value = await body(request as unknown as Request)
          if (Object.keys(value).some((key) => !['collectionIds', 'action', 'idempotencyKey'].includes(key))) throw new AdminHttpError(400, 'invalid_request')
          const key = (request.headers.get('idempotency-key')?.trim()) ?? (typeof value.idempotencyKey === 'string' ? value.idempotencyKey : undefined)
          const requestId = request.headers.get('x-request-id')?.trim()
          if (!key || !requestId || !Array.isArray(value.collectionIds) || value.collectionIds.some((id) => typeof id !== 'string') || (value.action !== 'add' && value.action !== 'remove')) throw new AdminHttpError(400, 'invalid_request')
          const actor = await authenticateAdminRequest(request as unknown as Request)
          const collectionIds = value.collectionIds as string[]
          const ifMatch = request.headers.get('if-match')
          if (ifMatch !== null) {
            if (collectionIds.length !== 1) throw new AdminHttpError(400, 'invalid_request')
            const pinned = parseIfMatch(request.headers)
            const collections = request.payload.db.collections['collections']
            if (!collections) throw new Error('Missing collections model')
            const target = await (collections as unknown as { findById(id: string): { lean(): Promise<unknown> } }).findById(collectionIds[0]).lean() as Record<string, unknown> | null
            if (!target || Number(target.draftRevision) !== pinned || target.lifecycle === 'archived' || target.draftState === 'publishing') throw new AdminHttpError(412, 'revision_conflict')
          }
          const parent = await enqueueMultiTarget(request.payload, {
            selectionId: routeId(request, 'selectionId'), collectionIds, action: value.action,
            idempotencyKey: key, actorId: actor.user_id, requestId,
          })
          return Response.json({ operationId: parent.id }, { status: 202 })
        } catch (error) {
          return adminErrorResponse(error)
        }
      },
    },
    {
      method: 'get', path: '/admin/v1/operations',
      handler: async (request: PayloadRequest) => {
        try {
          const actor = await authenticateAdminRequest(request as unknown as Request)
          const query = (request as { query?: Record<string, unknown> }).query
          if (query?.actor !== 'current' || query?.active !== 'true') throw new AdminHttpError(400, 'invalid_request')
          const operations = operationModels(request)
          const after = cursorParam(request)
          const rows = await operations.find({
            actorId: actor.user_id, mode: 'selection', parentOperationId: null, status: 'active',
            ...(after ? { _id: { $gt: after } } : {}),
          }).sort({ _id: 1 }).limit(ACTIVE_LIST_LIMIT + 1).lean() as Array<Record<string, unknown>>
          const page = rows.slice(0, ACTIVE_LIST_LIMIT)
          const parentIds = page.map(idOf)
          const aggregated = await operations.aggregate([
            { $match: { parentOperationId: { $in: parentIds }, actorId: actor.user_id } },
            { $group: { _id: '$parentOperationId', children: { $push: { status: '$status', progress: '$progress' } } } },
          ]).exec() as Array<{ _id: string; children: Array<Record<string, unknown>> }>
          const byParent = new Map(aggregated.map((row) => [String(row._id), row.children]))
          const cancellableStatuses = new Set(['queued', 'materializing', 'staging', 'validating'])
          const items = page.map((value) => {
            const id = idOf(value)
            const children = byParent.get(id) ?? []
            const summary = parentSummary(children)
            const status = effectiveParentStatus(summary)
            if (status !== 'active') {
              void operations.updateOne({ _id: id, actorId: actor.user_id, status: 'active' }, { $set: { status, updatedAt: new Date() } })
              return null
            }
            return {
              id, action: value.action, selectionId: value.selectionId ?? null,
              status, parentSummary: summary, progress: sumProgress(children),
              cancellable: children.some((child) => cancellableStatuses.has(String(child.status))),
              createdAt: value.createdAt, updatedAt: value.updatedAt,
            }
          }).filter((item): item is NonNullable<typeof item> => item !== null)
          return Response.json({ items, nextCursor: rows.length > ACTIVE_LIST_LIMIT ? nextCursor(idOf(rows[ACTIVE_LIST_LIMIT - 1])) : null })
        } catch (error) {
          return adminErrorResponse(error)
        }
      },
    },
    {
      method: 'get', path: '/admin/v1/operations/:id',
      handler: async (request: PayloadRequest) => {
        try {
          const actor = await authenticateAdminRequest(request as unknown as Request, { allowCollectorBearer: true, allowCollectorOperationRead: true })
          const operationId = routeId(request)
          const operation = await loadOperation(request, operationId)
          if (!operation) throw new AdminHttpError(404, 'not_found')
          assertOperationOwnedBy(operation, actor.user_id)
          const isCollector = readCollectorOrigin(request)
          if (isCollector && (operation.mode !== 'explicit' || Number(operation.selectedCount) !== 1)) throw new AdminHttpError(404, 'not_found')
          if (isCollector) return Response.json({ id: operationId, status: operation.status, progress: operation.progress, errorCode: operation.errorCode ?? null })

          const parentId = operation.parentOperationId
          if (typeof parentId === 'string') {
            const summarized = await parentWithSummary(request, parentId, actor.user_id)
            if (!summarized) throw new AdminHttpError(404, 'not_found')
            const { parent, summary, children } = summarized
            return Response.json({
              id: parent.id, status: effectiveParentStatus(summary), parentSummary: summary,
              progress: sumProgress(children),
              cancellable: children.some((child) => ['queued', 'materializing', 'staging', 'validating'].includes(String(child.status))),
              action: parent.action, selectionId: parent.selectionId,
              createdAt: parent.createdAt, updatedAt: parent.updatedAt,
            })
          }
          if (operation.mode === 'selection') {
            const children = await operationModels(request).find({ parentOperationId: operationId, actorId: actor.user_id }).lean() as Array<Record<string, unknown>>
            const summary = parentSummary(children)
            return Response.json({
              id: idOf(operation), status: effectiveParentStatus(summary), parentSummary: summary,
              progress: sumProgress(children), action: operation.action, selectionId: operation.selectionId ?? null,
              cancellable: children.some((child) => ['queued', 'materializing', 'staging', 'validating'].includes(String(child.status))),
              createdAt: operation.createdAt, updatedAt: operation.updatedAt,
            })
          }
          return Response.json(publicStandaloneOperation(operation))
        } catch (error) {
          return adminErrorResponse(error)
        }
      },
    },
    {
      method: 'post', path: '/admin/v1/operations/:id/cancel',
      handler: guard(async (request, actor) => {
        const operationId = routeId(request)
        const operation = await loadOperation(request, operationId)
        if (!operation) throw new AdminHttpError(404, 'not_found')
        assertOperationOwnedBy(operation, actor.user_id)
        return Response.json(await cancelDraftOperation(request.payload, operationId))
      }),
    },
  ]
}