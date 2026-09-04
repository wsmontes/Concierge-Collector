import type { Payload } from 'payload'

export const LATEST_CMS_MIGRATION = '20260904_016_operation_retention_quarantine'

type IndexSignature = {
  name: string
  key: Record<string, number>
  unique?: boolean
  expireAfterSeconds?: number
}

const REQUIRED_INDEXES: Readonly<Record<string, readonly IndexSignature[]>> = {
  collections: [
    { name: 'collections_slug_unique', key: { slug: 1 }, unique: true },
  ],
  'collection-draft-changes': [
    { name: 'staging_retention_scan', key: { stageState: 1, updatedAt: 1, _id: 1 } },
  ],
  'collection-operations': [
    { name: 'operation_queue_order', key: { collectionId: 1, operationSequence: 1, status: 1 } },
    { name: 'operation_retention_scan', key: { status: 1, 'itemArchive.itemsPurgedAt': 1, updatedAt: 1 } },
    {
      name: 'operation_retention_due',
      key: {
        status: 1,
        'itemArchive.itemsPurgedAt': 1,
        'itemArchive.retentionBlockedAt': 1,
        updatedAt: 1,
        _id: 1,
      },
    },
  ],
  'collection-publish-jobs': [
    { name: 'publish_lease_expiry', key: { status: 1, leaseExpiresAt: 1 } },
  ],
  'collection-exports': [
    { name: 'export_expiry_status', key: { expiresAt: 1, status: 1 } },
    { name: 'export_cleanup_due', key: { status: 1, cleanupNextAttemptAt: 1, expiresAt: 1, _id: 1 } },
  ],
  'audit-events': [
    { name: 'audit_archive_scan', key: { createdAt: 1, _id: 1 } },
  ],
  'audit-archive-manifests': [
    { name: 'audit_archive_batch_unique', key: { batchKey: 1 }, unique: true },
  ],
  'worker-heartbeats': [
    { name: 'worker_heartbeat_ttl', key: { observedAt: 1 }, expireAfterSeconds: 7 * 24 * 60 * 60 },
  ],
}

export interface CmsSchemaReadiness {
  ready: boolean
  migration: 'ready' | 'missing'
  indexes: 'ready' | 'missing'
  missingIndexes: string[]
}

type IndexDocument = {
  name?: string
  key?: Record<string, number>
  unique?: boolean
  expireAfterSeconds?: number
}

type IndexCapableModel = {
  collection: { indexes(): Promise<IndexDocument[]> }
}

type MigrationModel = {
  findOne(query: Record<string, unknown>): { lean(): Promise<Record<string, unknown> | null> }
}

function orderedKeyEquals(actual: Record<string, number> | undefined, expected: Record<string, number>): boolean {
  if (!actual) return false
  return JSON.stringify(Object.entries(actual)) === JSON.stringify(Object.entries(expected))
}

function indexMatches(actual: IndexDocument | undefined, expected: IndexSignature): boolean {
  if (!actual || actual.name !== expected.name || !orderedKeyEquals(actual.key, expected.key)) return false
  if (expected.unique !== undefined && Boolean(actual.unique) !== expected.unique) return false
  if (
    expected.expireAfterSeconds !== undefined &&
    Number(actual.expireAfterSeconds) !== expected.expireAfterSeconds
  ) return false
  return true
}

/**
 * Read-only compatibility gate used by `/ready`. It never creates indexes,
 * repairs data or runs migrations; rollout owns those mutations explicitly.
 *
 * Readiness verifies critical index signatures, not names alone: key order,
 * required uniqueness and TTL values must match the migration contract.
 */
export async function checkCmsSchemaReadiness(payload: Payload): Promise<CmsSchemaReadiness> {
  const migrations = payload.db.collections['payload-migrations'] as unknown as MigrationModel | undefined
  const migration = migrations
    ? await migrations.findOne({ name: LATEST_CMS_MIGRATION }).lean()
    : null

  const missingIndexes: string[] = []
  for (const [slug, requiredIndexes] of Object.entries(REQUIRED_INDEXES)) {
    const model = payload.db.collections[slug] as unknown as IndexCapableModel | undefined
    if (!model) {
      missingIndexes.push(...requiredIndexes.map(({ name }) => `${slug}:${name}`))
      continue
    }

    let deployed: IndexDocument[]
    try {
      deployed = await model.collection.indexes()
    } catch {
      missingIndexes.push(...requiredIndexes.map(({ name }) => `${slug}:${name}`))
      continue
    }

    for (const expected of requiredIndexes) {
      const actual = deployed.find((index) => index.name === expected.name)
      if (!indexMatches(actual, expected)) missingIndexes.push(`${slug}:${expected.name}`)
    }
  }

  return {
    ready: Boolean(migration) && missingIndexes.length === 0,
    migration: migration ? 'ready' : 'missing',
    indexes: missingIndexes.length === 0 ? 'ready' : 'missing',
    missingIndexes,
  }
}