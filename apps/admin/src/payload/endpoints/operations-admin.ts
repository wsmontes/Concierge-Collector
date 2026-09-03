import type { Endpoint, PayloadRequest } from 'payload'
import type { CmsIdentity } from '../../auth/fastapi-authz-client'
import { AdminHttpError } from '../../http/errors'
import { withAdmin } from '../../http/with-admin'
import { cancelDraftOperation } from '../../operations/apply-draft-operation'

const PAGE_LIMIT = 30
const TERMINAL = ['committed', 'completed', 'completed_with_skips', 'failed', 'cancelled', 'stale', 'conflicted', 'authorization_revoked']
const SUCCESS_TERMINAL = ['committed', 'completed', 'completed_with_skips']
const FAILED_TERMINAL = ['failed', 'cancelled', 'stale', 'conflicted', 'authorization_revoked']
const CANCELLABLE = new Set(['queued', 'materializing', 'staging', 'validating'])

type RecordValue = Record<string, unknown>

type RawCollection = {
  find(query: RecordValue, options?: RecordValue): {
    sort(sort: RecordValue): {
      limit(limit: number): { toArray(): Promise<RecordValue[]> }
    }
  }
  findOne?(query: RecordValue): Promise<RecordValue | null>
  aggregate(pipeline: RecordValue[]): { toArray(): Promise<RecordValue[]> }
}

function guard(handler: (request: PayloadRequest, actor: CmsIdentity) => Promise<Response>) {
  const guarded = withAdmin((request, actor) => handler(request as unknown as PayloadRequest, actor))
  return (request: PayloadRequest) => guarded(request as unknown as Request)
}

function queryValue(request: PayloadRequest, key: string): string | null {
  const query = (request as { query?: Record<string, unknown> }).query
  const value = query?.[key]
  if (typeof value === 'string') return value
  try { return new URL((request as unknown as Request).url).searchParams.get(key) } catch { return null }
}

function requireCurrentActorQuery(request: PayloadRequest): void {
  if (queryValue(request, 'actor') !== 'current') throw new AdminHttpError(400, 'invalid_request')
}

function routeId(request: PayloadRequest): string {
  const id = request.routeParams?.id
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw new AdminHttpError(404, 'not_found')
  return id
}

function decodeCursor(request: PayloadRequest): string | null {
  const raw = queryValue(request, 'cursor')
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { after?: unknown }
    if (typeof parsed.after !== 'string' || !/^[a-f\d]{24}$/i.test(parsed.after)) throw new Error('invalid')
    return parsed.after
  } catch { throw new AdminHttpError(400, 'invalid_request') }
}

function encodeCursor(after: string): string {
  return Buffer.from(JSON.stringify({ after }), 'utf8').toString('base64url')
}

function idOf(value: RecordValue): string { return String(value.id ?? value._id) }

function operationModel(request: PayloadRequest) {
  const model = request.payload.db.collections['collection-operations']
  if (!model) throw new Error('Missing collection operations model')
  return model as unknown as {
    collection: RawCollection
    find(query: RecordValue): { select(projection: RecordValue): { lean(): Promise<RecordValue[]> } }
  }
}

function operationCollection(request: PayloadRequest): RawCollection { return operationModel(request).collection }

function publishModel(request: PayloadRequest) {
  const model = request.payload.db.collections['collection-publish-jobs']
  if (!model) throw new Error('Missing collection publish jobs model')
  return model as unknown as {
    find(query: RecordValue): { sort(sort: RecordValue): { limit(limit: number): { lean(): Promise<RecordValue[]> } } }
  }
}

async function collectionDirectory(request: PayloadRequest, ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; title: string; slug: string }>()
  const model = request.payload.db.collections.collections
  if (!model) throw new Error('Missing collections model')
  const documents = await (model as unknown as {
    find(query: RecordValue, projection?: RecordValue): { lean(): Promise<RecordValue[]> }
  }).find({ _id: { $in: ids } }, { title: 1, slug: 1 }).lean()
  return new Map(documents.map((document) => {
    const id = idOf(document)
    return [id, { id, title: String(document.title ?? 'Collection'), slug: String(document.slug ?? '') }]
  }))
}

function parentSummary(children: RecordValue[]) {
  return {
    active: children.filter((child) => !TERMINAL.includes(String(child.status))).length,
    completed: children.filter((child) => SUCCESS_TERMINAL.includes(String(child.status))).length,
    failed: children.filter((child) => FAILED_TERMINAL.includes(String(child.status))).length,
  }
}

function effectiveStatus(summary: { active: number; completed: number; failed: number }): 'active' | 'completed' | 'failed' {
  if (summary.active > 0) return 'active'
  return summary.failed > 0 ? 'failed' : 'completed'
}

function sumProgress(children: RecordValue[]) {
  const total = { processed: 0, skipped: 0, failed: 0 }
  for (const child of children) {
    const progress = child.progress as Record<string, unknown> | undefined
    total.processed += Number(progress?.processed ?? 0)
    total.skipped += Number(progress?.skipped ?? 0)
    total.failed += Number(progress?.failed ?? 0)
  }
  return total
}

function uniqueIds(children: RecordValue[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const child of children) {
    const id = typeof child.collectionId === 'string' ? child.collectionId : null
    if (id && !seen.has(id)) { seen.add(id); ids.push(id) }
  }
  return ids
}

async function recentBulkOperations(request: PayloadRequest, actorId: string) {
  const after = decodeCursor(request)
  const operations = operationCollection(request)
  const parents = await operations.find({
    actorId, mode: 'selection', parentOperationId: null,
    ...(after ? { _id: { $lt: after } } : {}),
  }, {
    projection: { actorId: 0, idempotencyKey: 0, requestHash: 0, requestId: 0 },
  }).sort({ _id: -1 }).limit(PAGE_LIMIT + 1).toArray()
  const page = parents.slice(0, PAGE_LIMIT)
  const parentIds = page.map(idOf)
  const aggregate = parentIds.length === 0 ? [] : await operations.aggregate([
    { $match: { parentOperationId: { $in: parentIds }, actorId } },
    {
      $group: {
        _id: '$parentOperationId',
        children: { $push: { status: '$status', progress: '$progress', collectionId: '$collectionId' } },
        latestUpdatedAt: { $max: '$updatedAt' },
      },
    },
  ]).toArray()
  const byParent = new Map(aggregate.map((row) => [String(row._id), row]))
  const allCollectionIds = [...new Set(aggregate.flatMap((row) => uniqueIds((row.children ?? []) as RecordValue[])))]
  const directory = await collectionDirectory(request, allCollectionIds)

  const items = page.map((parent) => {
    const id = idOf(parent)
    const aggregated = byParent.get(id)
    const children = (aggregated?.children ?? []) as RecordValue[]
    const summary = parentSummary(children)
    const ids = uniqueIds(children)
    return {
      id, action: parent.action, status: effectiveStatus(summary), parentSummary: summary,
      progress: sumProgress(children), cancellable: children.some((child) => CANCELLABLE.has(String(child.status))),
      collections: ids.map((collectionId) => directory.get(collectionId) ?? { id: collectionId, title: 'Collection', slug: '' }),
      createdAt: parent.createdAt, updatedAt: aggregated?.latestUpdatedAt ?? parent.updatedAt,
    }
  })

  return { items, nextCursor: parents.length > PAGE_LIMIT ? encodeCursor(idOf(page[page.length - 1])) : null }
}

async function recentPublishJobs(request: PayloadRequest, actorId: string) {
  const after = decodeCursor(request)
  const rows = await publishModel(request).find({ actorId, ...(after ? { _id: { $lt: after } } : {}) })
    .sort({ _id: -1 }).limit(PAGE_LIMIT + 1).lean()
  const page = rows.slice(0, PAGE_LIMIT)
  const ids = [...new Set(page.map((row) => String(row.collectionId)).filter(Boolean))]
  const directory = await collectionDirectory(request, ids)
  return {
    items: page.map((row) => {
      const collectionId = String(row.collectionId)
      return {
        id: idOf(row), collection: directory.get(collectionId) ?? { id: collectionId, title: 'Collection', slug: '' },
        targetVersion: Number(row.targetVersion), status: String(row.status), checkpoint: row.checkpoint ?? null,
        selectedCount: row.selectedCount ?? null, confirmedUnavailableCount: Number(row.confirmedUnavailableCount ?? 0),
        createdAt: row.createdAt, updatedAt: row.updatedAt,
      }
    }),
    nextCursor: rows.length > PAGE_LIMIT ? encodeCursor(idOf(page[page.length - 1])) : null,
  }
}

async function cancelParentOperation(request: PayloadRequest, actorId: string, parentId: string) {
  const model = operationModel(request)
  if (!model.collection.findOne) throw new Error('Operation collection does not support findOne')
  const parent = await model.collection.findOne({ _id: parentId, actorId, mode: 'selection', parentOperationId: null })
  if (!parent) throw new AdminHttpError(404, 'not_found')

  const children = await model.find({
    parentOperationId: parentId,
    actorId,
    status: { $in: [...CANCELLABLE] },
  }).select({ _id: 1, status: 1 }).lean()

  let cancelled = 0
  let conflicts = 0
  for (const child of children) {
    try {
      await cancelDraftOperation(request.payload, idOf(child))
      cancelled += 1
    } catch (error) {
      if (error instanceof AdminHttpError && error.status === 409) { conflicts += 1; continue }
      throw error
    }
  }
  return { cancelled, conflicts }
}

/** Read-only operational history plus safe parent cancellation for the CMS. Collector operation contracts stay in operations.ts. */
export function operationsAdminEndpoints(): Endpoint[] {
  return [
    {
      method: 'get', path: '/admin/v1/operation-history',
      handler: guard(async (request, actor) => {
        requireCurrentActorQuery(request)
        return Response.json(await recentBulkOperations(request, actor.user_id))
      }),
    },
    {
      method: 'post', path: '/admin/v1/operation-history/:id/cancel',
      handler: guard(async (request, actor) => Response.json(await cancelParentOperation(request, actor.user_id, routeId(request)))),
    },
    {
      method: 'get', path: '/admin/v1/publish-jobs',
      handler: guard(async (request, actor) => {
        requireCurrentActorQuery(request)
        return Response.json(await recentPublishJobs(request, actor.user_id))
      }),
    },
  ]
}