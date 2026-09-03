import type { ClientSession, Model } from 'mongoose'
import type { Payload } from 'payload'
import { AdminHttpError } from '../http/errors'
import type { PublishJobRecord, PublishLease } from './types'

type DocumentModel = Model<Record<string, unknown>>

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function ownedFence(job: PublishJobRecord, lease: PublishLease) {
  return {
    _id: job.id,
    leaseOwner: lease.owner,
    fencingToken: lease.fencingToken,
    leaseExpiresAt: { $gt: new Date() },
  }
}

async function assertOwnedRunningFence(
  jobs: DocumentModel,
  job: PublishJobRecord,
  lease: PublishLease,
  session: ClientSession,
): Promise<void> {
  const owned = await jobs.findOne({
    ...ownedFence(job, lease),
    status: 'running',
  }).session(session).lean()
  if (!owned) throw new AdminHttpError(409, 'conflict')
}

/**
 * Rebuilds the invisible target-version staging from the published base.
 *
 * A terminally failed publish is deliberately allowed to leave target-version
 * intervals and a `ready` version behind for forensic/recovery purposes. A
 * later, NEW publish can target that same version after the editor changed the
 * draft, so it must not inherit that stale staging. Under the current publish
 * fence we discard only unpublished target-version artifacts, restore base
 * intervals that were tentatively closed at that version, and let the caller
 * reapply its fixed draft from scratch.
 *
 * Returns false rather than mutating anything when the target version is
 * already published. The caller terminalizes that impossible/stale job.
 */
export async function resetTargetVersionStaging(
  payload: Payload,
  job: PublishJobRecord,
  lease: PublishLease,
): Promise<boolean> {
  const jobs = modelFor(payload, 'collection-publish-jobs')
  const memberships = modelFor(payload, 'collection-memberships')
  const versions = modelFor(payload, 'collection-versions')
  const session = await payload.db.connection.startSession()

  try {
    let reset = false
    await session.withTransaction(async () => {
      await assertOwnedRunningFence(jobs, job, lease, session)

      const published = await versions.findOne({
        collectionId: job.collectionId,
        version: job.targetVersion,
        status: 'published',
      }).session(session).lean()
      if (published) return

      // Delete staged additions first. This guarantees that reopening a base
      // interval below cannot collide with membership_open_unique.
      await memberships.deleteMany({
        collectionId: job.collectionId,
        addedInVersion: job.targetVersion,
      }, { session })
      await memberships.updateMany({
        collectionId: job.collectionId,
        addedInVersion: { $lt: job.targetVersion },
        removedInVersion: job.targetVersion,
      }, {
        $set: { removedInVersion: null, updatedAt: new Date() },
      }, { session })
      await versions.deleteMany({
        collectionId: job.collectionId,
        version: job.targetVersion,
        status: 'ready',
      }, { session })

      const marked = await jobs.updateOne({
        ...ownedFence(job, lease),
        status: 'running',
      }, {
        $set: { checkpoint: 'staging_reset', updatedAt: new Date() },
      }, { session })
      if (marked.modifiedCount !== 1) throw new AdminHttpError(409, 'conflict')
      reset = true
    })
    return reset
  } finally {
    await session.endSession()
  }
}
