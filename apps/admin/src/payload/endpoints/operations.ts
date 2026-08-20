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
    for (const key of ['processed', 'skipped', 'failed'] as const) {
      totals[key] += Number(progress[key] ?? 0)
    }
  }
  return totals
}

/** Loads a parent and aggregates its children's outcomes at read time. */
async function parentWithSummary(request: PayloadRequest, parentId: string): Promise<{ parent: ParentOperationRecord; summary: ParentSummary; children: Array<Record<string, unknown>> } | null> {
  const operations = operationModels(request)
  const parent = await operations.findById(parentId).lean()
  if (!parent) return null
  const value = parent as Record<string, unknown>
  if (value.parentOperationId) return null
  const children = await operations.find({ parentOperationId: parentId }).lean() as Array<Record<string, unknown>>
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
        // The Collector-facing contract is snake_case. Keep camelCase only for
        // already-issued Admin clients while the CMS UI is being introduced.
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
          // The Collector guard stays explicit and cardinality-one; a manifest
          // never flows through the Collector-facing contract.
          if (curationIds !== undefined || typeof value.selection_id !== 'string') throw new AdminHttpError(400, 'invalid_request')
          const actor = await authenticateAdminRequest(request as unknown as Request)
          const operation = await enqueueSelectionOperation(request.payload, {
            collectionId: routeId(request), selectionId: value.selection_id, action: value.action,
            idempotencyKey: key, actorId: actor.user_id, requestId,
          })
          return Response.json(operation, { status: 202 })
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
        return Response.json(operation, { status: 202 })
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
          if (!key || !requestId || !Array.isArray(value.collectionIds) || value.collectionIds.some((id) => typeof id !== 'string') || (value.action !== 'add' && value.action !== 'remove')) {
            throw new AdminHttpError(400, 'invalid_request')
          }
          const actor = await authenticateAdminRequest(request as unknown as Request)
          const collectionIds = value.collectionIds as string[]
          const ifMatch = request.headers.get('if-match')
          if (ifMatch !== null) {
            // Optional single-Collection precondition: pin the intent to the
            // draft revision the picker showed. Across Collections there is no
            // single atomic revision, so the precondition is only meaningful
            // for a single target (revisions are otherwise captured enqueue-time).
            if (collectionIds.length !== 1) throw new AdminHttpError(400, 'invalid_request')
            const pinned = parseIfMatch(request.headers)
            const collections = request.payload.db.collections['collections']
            if (!collections) throw new Error('Missing collections model')
            const target = await (collections as unknown as { findById(id: string): { lean(): Promise<unknown> } }).findById(collectionIds[0]).lean() as Record<string, unknown> | null
            if (!target || Number(target.draftRevision) !== pinned || target.lifecycle === 'archived' || target.draftState === 'publishing') {
              throw new AdminHttpError(412, 'revision_conflict')
            }
          }
          const parent = await enqueueMultiTarget(request.payload, {
            selectionId: routeId(request, 'selectionId'),
            collectionIds,
            action: value.action,
            idempotencyKey: key,
            actorId: actor.user_id,
            requestId,
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
            actorId: actor.user_id,
            mode: 'selection',
            parentOperationId: null,
            status: 'active',
            ...(after ? { _id: { $gt: after } } : {}),
          }).sort({ _id: 1 }).limit(ACTIVE_LIST_LIMIT + 1).lean() as Array<Record<string, unknown>>
          const page = rows.slice(0, ACTIVE_LIST_LIMIT)
          const parentIds = page.map(idOf)
          const aggregated = await operations.aggregate([
            { $match: { parentOperationId: { $in: parentIds } } },
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
              // Self-heal a parent whose children all finished without the
              // terminalization path (e.g. worker crash between commit and
              // reconcile); it no longer belongs in the active list.
              void operations.updateOne({ _id: id, status: 'active' }, { $set: { status, updatedAt: new Date() } })
              return null
            }
            return {
              id, action: value.action, selectionId: value.selectionId ?? null, selectionHash: value.selectionHash ?? null,
              status, parentSummary: summary, progress: sumProgress(children),
              cancellable: children.some((child) => cancellableStatuses.has(String(child.status))),
              requestId: value.requestId, createdAt: value.createdAt, updatedAt: value.updatedAt,
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
        const value = await operationModels(request).findById(operationId).lean()
        if (!value) throw new AdminHttpError(404, 'not_found')
        const operation = value as Record<string, unknown>
        const isCollector = readCollectorOrigin(request)
        if (isCollector && (operation.actorId !== actor.user_id || operation.mode !== 'explicit' || operation.selectedCount !== 1)) {
          throw new AdminHttpError(404, 'not_found')
        }
        if (isCollector) return Response.json({ id: operationId, status: operation.status, progress: operation.progress, errorCode: operation.errorCode ?? null })
        // A child of a parent is summarized by its parent: the UI tracks bulk
        // intents, not the per-Collection fan-out.
        const parentId = operation.parentOperationId
        if (typeof parentId === 'string') {
          const summarized = await parentWithSummary(request, parentId)
          if (!summarized) throw new AdminHttpError(404, 'not_found')
          const { parent, summary, children } = summarized
          return Response.json({
            id: parent.id, status: effectiveParentStatus(summary), parentSummary: summary,
            progress: sumProgress(children),
            cancellable: children.some((child) => ['queued', 'materializing', 'staging', 'validating'].includes(String(child.status))),
            action: parent.action, selectionId: parent.selectionId, selectionHash: parent.selectionHash,
            requestId: parent.requestId, createdAt: parent.createdAt, updatedAt: parent.updatedAt,
          })
        }
        return Response.json({ ...operation, id: idOf(operation) })
        } catch (error) {
          return adminErrorResponse(error)
        }
      },
    },
    {
      method: 'post', path: '/admin/v1/operations/:id/cancel',
      handler: guard(async (request) => Response.json(await cancelDraftOperation(request.payload, routeId(request)))),
    },
  ]
}
