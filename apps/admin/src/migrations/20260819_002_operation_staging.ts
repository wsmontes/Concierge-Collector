import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

const indexes = [
  ['collection-draft-changes', { operationId: 1, stageState: 1, draftEpoch: 1, curationId: 1 }, { name: 'draft_changes_by_stage' }],
  ['collection-operations', { jobId: 1 }, { name: 'operation_job_unique', unique: true }],
] as const

/**
 * Kept separate from the original Collections migration so installations that
 * already recorded 20260818_001 receive every staging-era schema change.
 */
export async function up({ payload, session }: MigrateUpArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') throw new Error('Collections migration requires the MongoDB adapter')

  const changes = adapter.collections['collection-draft-changes']
  if (!changes) throw new Error('Missing CMS collection model: collection-draft-changes')

  // Existing committed deltas predate the explicit stage marker.  Backfill
  // before workers start filtering for committed rows; otherwise an upgrade
  // would make every existing draft appear empty.
  await changes.updateMany(
    { stageState: { $exists: false } },
    { $set: { stageState: 'committed' } },
    { session },
  )

  for (const [slug, fields, options] of indexes) {
    const model = adapter.collections[slug]
    if (!model) throw new Error(`Missing CMS collection model: ${slug}`)
    try {
      await model.collection.createIndex(fields, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // A later migration (20260822_007) redefined `operation_job_unique` with
      // a partial filter that excludes parents. Re-running this older up()
      // against that state must keep the newer definition — never clobber it.
      if (!message.includes('same name as the requested index')) throw error
    }
  }
}

export async function down({ payload, session }: MigrateDownArgs): Promise<void> {
  const adapter = payload.db
  if (adapter.name !== 'mongoose') return

  for (const [slug, , options] of indexes) {
    const model = adapter.collections[slug]
    if (model) await model.collection.dropIndex(options.name)
  }
}
