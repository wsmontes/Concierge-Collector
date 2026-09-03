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

  const retained = await manifests.findOneAndUpdate(
    {
      _id: input.selectionId,
      actorId: input.actorId,
      status: 'ready',
      expiresAt: { $gt: now },
    },
    { $max: { retainedUntil }, $set: { updatedAt: now } },
    { new: true, lean: true },
  ).lean()

  if (!retained) throw new AdminHttpError(410, 'selection_expired')

  await items.updateMany(
    { selectionId: input.selectionId },
    { $max: { retainedUntil } },
  )
}
