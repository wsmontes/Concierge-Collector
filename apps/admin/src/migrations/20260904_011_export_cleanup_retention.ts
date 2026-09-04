import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'
import type { Model } from 'mongoose'

type DocumentModel = Model<Record<string, unknown>>
type RawIndexes = {
  createIndex(fields: Record<string, number>, options: Record<string, unknown>): Promise<unknown>
  dropIndex(name: string): Promise<unknown>
}

const OLD_TTL = 'export_artifact_ttl'
const LOOKUP = 'export_expiry_status'

function model(payload: MigrateUpArgs['payload'] | MigrateDownArgs['payload']): DocumentModel {
  const value = payload.db.collections['collection-exports']
  if (!value) throw new Error('Missing CMS collection model: collection-exports')
  return value as unknown as DocumentModel
}

async function dropIfPresent(raw: RawIndexes, name: string): Promise<void> {
  try {
    await raw.dropIndex(name)
  } catch (error) {
    const value = error as { code?: unknown; codeName?: unknown }
    if (value?.code === 27 || value?.codeName === 'IndexNotFound') return
    throw error
  }
}

/**
 * Export records must survive until object storage deletion is confirmed.
 * Mongo TTL could remove the only object key before DeleteObject succeeds, so
 * the maintenance worker now owns object-first cleanup and this migration keeps
 * only the bounded lookup index it needs.
 */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') throw new Error('Export cleanup retention requires the MongoDB adapter')
  const raw = model(payload).collection as unknown as RawIndexes
  await dropIfPresent(raw, OLD_TTL)
  await raw.createIndex({ expiresAt: 1, status: 1 }, { name: LOOKUP })
}

/**
 * Rollback is intentionally non-destructive. Removing the lookup index may
 * disable efficient maintenance in an older artifact, but recreating the old
 * TTL would reintroduce the known object-orphaning failure mode. Production
 * rollback is forward-only per the Collections rollback runbook.
 */
export async function down({ payload }: MigrateDownArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') return
  const raw = model(payload).collection as unknown as RawIndexes
  await dropIfPresent(raw, LOOKUP)
}
