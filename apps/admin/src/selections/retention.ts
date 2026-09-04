import type { Model } from 'mongoose'
import type { Payload } from 'payload'
import { AdminHttpError } from '../http/errors'

type DocumentModel = Model<Record<string, unknown>>
const DEFAULT_USED_SELECTION_RETENTION_DAYS = 90

function modelFor(payload: Payload, slug: string): DocumentModel {
  const model = payload.db.collections[slug]
  if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
  return model as unknown as DocumentModel
}

function retentionDays(): number {
  const raw = process.env.CMS_USED_SELECTION_RETENTION_DAYS?.trim()
  if (!raw) return DEFAULT_USED_SELECTION_RETENTION_DAYS
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_USED_SELECTION_RETENTION_DAYS
}

/**
 * Extends deletion retention for a Selection that has become audit-relevant.
 * `expiresAt` remains untouched: callers still cannot reuse the selection after
 * its original validity window. Mongo TTL is driven by `retainedUntil` instead.
 *
 * This intentionally uses a monotonic fail-safe sequence rather than allowing
 * a partial write that could delete items before the retained manifest. A race
 * may over-retain items, but a successful return guarantees both sides were
 * extended; under-retention is never accepted as success.
 */
export async function retainSelectionForAudit(
  payload: Payload,
  input: {
    selectionId: string
    actorId: string
    now?: Date
    retainedUntil?: Date
  },
): Promise<void> {
  const now = input.now ?? new Date()
  const retainedUntil = input.retainedUntil
    ?? new Date(now.getTime() + retentionDays() * 24 * 60 * 60 * 1000)
  const manifests = modelFor(payload, 'selection-manifests')
  const items = modelFor(payload, 'selection-manifest-items')
  const predicate = {
    _id: input.selectionId,
    actorId: input.actorId,
    status: 'ready',
    expiresAt: { $gt: now },
  }

  const eligible = await manifests.findOne(predicate).select({ _id: 1 }).lean()
  if (!eligible) throw new AdminHttpError(410, 'selection_expired')

  // Retain items first. If the final manifest CAS loses an expiry/race, the
  // only side effect is harmless extra retention; callers still receive 410.
  await items.updateMany(
    { selectionId: input.selectionId },
    { $max: { retainedUntil } },
  )

  const retained = await manifests.findOneAndUpdate(
    predicate,
    { $max: { retainedUntil }, $set: { updatedAt: now } },
    { new: true, lean: true },
  ).lean()

  if (!retained) throw new AdminHttpError(410, 'selection_expired')
}
