import type { Endpoint, PayloadRequest } from 'payload'
import type { Model } from 'mongoose'
import { authenticateAdminRequest } from '../../auth/authenticate-admin-request'
import { AdminHttpError, adminErrorResponse } from '../../http/errors'

type DocumentModel = Model<Record<string, unknown>>

function modelFor(request: PayloadRequest, slug: string): DocumentModel {
  const model = request.payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function curationId(request: PayloadRequest): string {
  const id = request.routeParams?.id
  if (typeof id !== 'string' || !id || id.length > 256) throw new AdminHttpError(400, 'invalid_request')
  return id
}

function url(request: PayloadRequest): URL {
  return new URL((request as unknown as Request).url)
}

/**
 * Collector-safe view of eligible Collections. It intentionally contains only
 * the one current visible delta, never other members, audit or credentials.
 */
export function collectorCollectionEndpoints(): Endpoint[] {
  return [{
    method: 'get',
    path: '/admin/v1/curations/:id/collection-options',
    handler: async (request: PayloadRequest) => {
      try {
        const id = curationId(request)
        await authenticateAdminRequest(request as unknown as Request, {
          allowCollectorBearer: true,
          explicitCurationIds: [id],
        })
        const search = url(request).searchParams.get('q')?.trim()
        const collections = await modelFor(request, 'collections').find({
          lifecycle: { $ne: 'archived' },
          ...(search ? { $or: [{ slug: { $regex: search, $options: 'i' } }, { title: { $regex: search, $options: 'i' } }] } : {}),
        }).sort({ slug: 1 }).limit(100).lean() as Record<string, unknown>[]
        const memberships = modelFor(request, 'collection-memberships')
        const changes = modelFor(request, 'collection-draft-changes')
        const items = await Promise.all(collections.map(async (collection) => {
          const collectionId = String(collection._id)
          const draftRevision = Number(collection.draftRevision)
          const membership = typeof collection.currentPublishedVersion === 'number'
            ? await memberships.findOne({
              collectionId, curationId: id, addedInVersion: { $lte: collection.currentPublishedVersion },
              $or: [{ removedInVersion: null }, { removedInVersion: { $gt: collection.currentPublishedVersion } }],
            }).lean()
            : null
          const change = await changes.findOne({
            collectionId, curationId: id, draftEpoch: collection.draftEpoch, stageState: 'committed',
            targetDraftRevision: { $lte: draftRevision },
            $or: [{ validUntilDraftRevision: null }, { validUntilDraftRevision: { $gte: draftRevision } }],
          }).sort({ targetDraftRevision: -1 }).lean()
          return {
            collectionId,
            slug: String(collection.slug),
            title: String(collection.title),
            currentPublishedVersion: collection.currentPublishedVersion ?? null,
            draftRevision,
            draftState: String(collection.draftState),
            desiredState: change?.desiredState ?? (membership ? 'add' : 'remove'),
            locked: collection.draftState === 'publishing',
          }
        }))
        return Response.json({ items })
      } catch (error) {
        return adminErrorResponse(error)
      }
    },
  }]
}
