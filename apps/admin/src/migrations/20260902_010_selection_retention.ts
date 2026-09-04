import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'
import type { Model } from 'mongoose'

const USED_RETENTION_DAYS = 90
const BATCH_SIZE = 500

type DocumentModel = Model<Record<string, unknown>>

type RawIndexes = {
  createIndex(fields: Record<string, number>, options: Record<string, unknown>): Promise<unknown>
  dropIndex(name: string): Promise<unknown>
}

function model(payload: MigrateUpArgs['payload'] | MigrateDownArgs['payload'], slug: string): DocumentModel {
  const value = payload.db.collections[slug]
  if (!value) throw new Error(`Missing CMS collection model: ${slug}`)
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

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size))
  return output
}

async function referencedSelectionIds(payload: MigrateUpArgs['payload']): Promise<string[]> {
  const operations = await model(payload, 'collection-operations').distinct('selectionId', { selectionId: { $type: 'string' } })
  const exports = await model(payload, 'collection-exports').distinct('selectionId', { selectionId: { $type: 'string' } })
  return [...new Set([...operations, ...exports].map(String).filter((id) => /^[a-f\d]{24}$/i.test(id)))]
}

async function retainExistingUsedSelections(payload: MigrateUpArgs['payload']): Promise<void> {
  const ids = await referencedSelectionIds(payload)
  if (!ids.length) return
  // Existing references pre-date the split validity/retention model. Preserve
  // them for a fresh full audit window from migration time rather than risk
  // deleting evidence immediately because the old 24h validity already passed.
  const retainedUntil = new Date(Date.now() + USED_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const manifests = model(payload, 'selection-manifests')
  const items = model(payload, 'selection-manifest-items')
  for (const batch of chunks(ids, BATCH_SIZE)) {
    await manifests.updateMany({ _id: { $in: batch } }, { $max: { retainedUntil } })
    await items.updateMany({ selectionId: { $in: batch } }, { $max: { retainedUntil } })
  }
}

export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') throw new Error('Selection retention requires the MongoDB adapter')
  const manifestRaw = model(payload, 'selection-manifests').collection as unknown as RawIndexes
  const itemRaw = model(payload, 'selection-manifest-items').collection as unknown as RawIndexes

  // First remove the unconditional TTL. If a later step fails, the safe failure
  // mode is temporary retention, never premature audit deletion.
  await dropIfPresent(manifestRaw, 'selection_manifest_ttl')
  await dropIfPresent(itemRaw, 'selection_item_ttl')

  await retainExistingUsedSelections(payload)

  await manifestRaw.createIndex(
    { expiresAt: 1 },
    {
      name: 'selection_manifest_unused_ttl',
      expireAfterSeconds: 0,
      partialFilterExpression: { retainedUntil: null },
    },
  )
  await manifestRaw.createIndex(
    { retainedUntil: 1 },
    { name: 'selection_manifest_retained_ttl', expireAfterSeconds: 0 },
  )
  await itemRaw.createIndex(
    { expiresAt: 1 },
    {
      name: 'selection_item_unused_ttl',
      expireAfterSeconds: 0,
      partialFilterExpression: { retainedUntil: null },
    },
  )
  await itemRaw.createIndex(
    { retainedUntil: 1 },
    { name: 'selection_item_retained_ttl', expireAfterSeconds: 0 },
  )
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  if (payload.db.name !== 'mongoose') return
  const manifestRaw = model(payload, 'selection-manifests').collection as unknown as RawIndexes
  const itemRaw = model(payload, 'selection-manifest-items').collection as unknown as RawIndexes

  await dropIfPresent(manifestRaw, 'selection_manifest_unused_ttl')
  await dropIfPresent(manifestRaw, 'selection_manifest_retained_ttl')
  await dropIfPresent(itemRaw, 'selection_item_unused_ttl')
  await dropIfPresent(itemRaw, 'selection_item_retained_ttl')

  // Down exists for disposable/dev databases. Production recovery remains
  // forward-only and must not deliberately shorten retained audit evidence.
  await manifestRaw.createIndex(
    { expiresAt: 1 },
    { name: 'selection_manifest_ttl', expireAfterSeconds: 0 },
  )
  await itemRaw.createIndex(
    { expiresAt: 1 },
    { name: 'selection_item_ttl', expireAfterSeconds: 0 },
  )
}
