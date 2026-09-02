import type { Model } from 'mongoose'
import type { Payload } from 'payload'
import { AdminHttpError } from '../http/errors'
import { FastApiPublishAvailabilityClient } from './availability-client'
import { inspectAvailability, streamDraftMembershipIds } from './membership-stream'
import type { PublishAvailabilityClient } from './types'

type DocumentModel = Model<Record<string, unknown>>

export interface PublishPreviewInput {
  collectionId: string
  actorId: string
}

export interface PublishPreviewResult {
  currentPublishedVersion: number | null
  nextVersion: number
  draftRevision: number
  revision: number
  selectedCount: number
  availableCount: number
  unavailableCount: number
  addCount: number
  removeCount: number
}

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function assertObjectId(value: string): void {
  if (!/^[a-f\d]{24}$/i.test(value)) throw new AdminHttpError(404, 'not_found')
}

async function visibleDraftDeltaCounts(input: {
  changes: DocumentModel
  collectionId: string
  draftEpoch: string
  draftRevision: number
}): Promise<{ addCount: number; removeCount: number }> {
  const cursor = input.changes.find({
    collectionId: input.collectionId,
    draftEpoch: input.draftEpoch,
    stageState: 'committed',
    targetDraftRevision: { $lte: input.draftRevision },
    $or: [{ validUntilDraftRevision: null }, { validUntilDraftRevision: { $gte: input.draftRevision } }],
  }).sort({ curationId: 1, targetDraftRevision: -1 }).cursor() as unknown as AsyncIterable<Record<string, unknown>>

  let previousCurationId: string | undefined
  let addCount = 0
  let removeCount = 0
  for await (const change of cursor) {
    const curationId = String(change.curationId)
    if (curationId === previousCurationId) continue
    previousCurationId = curationId
    if (change.desiredState === 'add') addCount += 1
    else if (change.desiredState === 'remove') removeCount += 1
  }
  return { addCount, removeCount }
}

/**
 * Computes the exact live publish preflight without mutating Collection state.
 * The publish command still re-runs this availability check before enqueueing,
 * so the preview is informative rather than an authorization or consistency
 * shortcut.
 */
export async function getPublishPreview(
  payload: Payload,
  input: PublishPreviewInput,
  client: PublishAvailabilityClient = new FastApiPublishAvailabilityClient(),
): Promise<PublishPreviewResult> {
  assertObjectId(input.collectionId)
  const collection = await modelFor(payload, 'collections').findById(input.collectionId).lean() as Record<string, unknown> | null
  if (!collection) throw new AdminHttpError(404, 'not_found')
  if (collection.lifecycle === 'archived') throw new AdminHttpError(409, 'conflict')
  if (collection.draftState === 'publishing') throw new AdminHttpError(423, 'draft_locked')

  await client.introspectAdmin(input.actorId)

  const currentPublishedVersion = typeof collection.currentPublishedVersion === 'number'
    ? collection.currentPublishedVersion
    : null
  const memberships = modelFor(payload, 'collection-memberships')
  const changes = modelFor(payload, 'collection-draft-changes')
  const draftEpoch = String(collection.draftEpoch)
  const draftRevision = Number(collection.draftRevision)
  const [availability, deltaCounts] = await Promise.all([
    inspectAvailability(streamDraftMembershipIds({
      memberships,
      changes,
      collectionId: input.collectionId,
      baseVersion: currentPublishedVersion,
      draftEpoch,
      draftRevision,
    }), (ids) => client.hydrateCurations(ids)),
    visibleDraftDeltaCounts({
      changes,
      collectionId: input.collectionId,
      draftEpoch,
      draftRevision,
    }),
  ])

  return {
    currentPublishedVersion,
    nextVersion: (currentPublishedVersion ?? 0) + 1,
    draftRevision,
    revision: Number(collection.revision),
    selectedCount: availability.selectedCount,
    availableCount: availability.availableCount,
    unavailableCount: availability.unavailableCount,
    addCount: deltaCounts.addCount,
    removeCount: deltaCounts.removeCount,
  }
}
