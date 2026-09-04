import type { Payload } from 'payload'

export const LATEST_CMS_MIGRATION = '20260904_013_audit_archival'

const REQUIRED_INDEXES: Readonly<Record<string, readonly string[]>> = {
  collections: ['collections_slug_unique'],
  'collection-operations': ['operation_queue_order', 'operation_retention_scan'],
  'collection-publish-jobs': ['publish_lease_expiry'],
  'collection-exports': ['export_expiry_status'],
  'audit-events': ['audit_archive_scan'],
  'audit-archive-manifests': ['audit_archive_batch_unique'],
  'worker-heartbeats': ['worker_heartbeat_ttl'],
}

export interface CmsSchemaReadiness {
  ready: boolean
  migration: 'ready' | 'missing'
  indexes: 'ready' | 'missing'
  missingIndexes: string[]
}

type IndexCapableModel = {
  collection: { indexes(): Promise<Array<{ name?: string }>> }
}

type MigrationModel = {
  findOne(query: Record<string, unknown>): { lean(): Promise<Record<string, unknown> | null> }
}

/**
 * Read-only compatibility gate used by `/ready`. It never creates indexes,
 * repairs data or runs migrations; rollout owns those mutations explicitly.
 */
export async function checkCmsSchemaReadiness(payload: Payload): Promise<CmsSchemaReadiness> {
  const migrations = payload.db.collections['payload-migrations'] as unknown as MigrationModel | undefined
  const migration = migrations
    ? await migrations.findOne({ name: LATEST_CMS_MIGRATION }).lean()
    : null

  const missingIndexes: string[] = []
  for (const [slug, requiredNames] of Object.entries(REQUIRED_INDEXES)) {
    const model = payload.db.collections[slug] as unknown as IndexCapableModel | undefined
    if (!model) {
      missingIndexes.push(...requiredNames.map((name) => `${slug}:${name}`))
      continue
    }
    let names: Set<string>
    try {
      names = new Set((await model.collection.indexes()).map((index) => String(index.name ?? '')))
    } catch {
      missingIndexes.push(...requiredNames.map((name) => `${slug}:${name}`))
      continue
    }
    for (const name of requiredNames) if (!names.has(name)) missingIndexes.push(`${slug}:${name}`)
  }

  return {
    ready: Boolean(migration) && missingIndexes.length === 0,
    migration: migration ? 'ready' : 'missing',
    indexes: missingIndexes.length === 0 ? 'ready' : 'missing',
    missingIndexes,
  }
}
