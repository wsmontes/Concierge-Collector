import { expect, test, vi } from 'vitest'
import { checkCmsSchemaReadiness, LATEST_CMS_MIGRATION } from '../../../src/operations/schema-readiness'

type IndexDoc = {
  name: string
  key: Record<string, number>
  unique?: boolean
  expireAfterSeconds?: number
}

const required: Record<string, IndexDoc[]> = {
  collections: [
    { name: 'collections_slug_unique', key: { slug: 1 }, unique: true },
  ],
  'collection-operations': [
    { name: 'operation_queue_order', key: { collectionId: 1, operationSequence: 1, status: 1 } },
    { name: 'operation_retention_scan', key: { status: 1, 'itemArchive.itemsPurgedAt': 1, updatedAt: 1 } },
  ],
  'collection-publish-jobs': [
    { name: 'publish_lease_expiry', key: { status: 1, leaseExpiresAt: 1 } },
  ],
  'collection-exports': [
    { name: 'export_expiry_status', key: { expiresAt: 1, status: 1 } },
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

function model(indexes: IndexDoc[]) {
  return {
    collection: { indexes: vi.fn().mockResolvedValue(indexes) },
  }
}

function payloadWith(input: {
  migration?: boolean
  missingIndex?: string
  mutateIndex?: (index: IndexDoc) => IndexDoc
} = {}) {
  const collections: Record<string, unknown> = {
    'payload-migrations': {
      findOne: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(input.migration === false ? null : { name: LATEST_CMS_MIGRATION }),
      }),
    },
  }
  for (const [slug, indexes] of Object.entries(required)) {
    collections[slug] = model(indexes
      .filter((index) => index.name !== input.missingIndex)
      .map((index) => input.mutateIndex ? input.mutateIndex({ ...index, key: { ...index.key } }) : index))
  }
  return { db: { collections } }
}

test('latest migration marker remains audit archival while readiness also checks older critical TTLs', () => {
  expect(LATEST_CMS_MIGRATION).toBe('20260904_013_audit_archival')
})

test('reports ready only when latest migration and critical index signatures are present', async () => {
  const result = await checkCmsSchemaReadiness(payloadWith() as never)

  expect(result).toEqual({ ready: true, migration: 'ready', indexes: 'ready', missingIndexes: [] })
})

test('fails closed when latest expected migration marker is missing', async () => {
  const result = await checkCmsSchemaReadiness(payloadWith({ migration: false }) as never)

  expect(result.ready).toBe(false)
  expect(result.migration).toBe('missing')
})

test('fails closed when any critical deployed index is missing', async () => {
  const result = await checkCmsSchemaReadiness(payloadWith({ missingIndex: 'export_expiry_status' }) as never)

  expect(result).toEqual(expect.objectContaining({
    ready: false,
    indexes: 'missing',
    missingIndexes: ['collection-exports:export_expiry_status'],
  }))
})

test('fails closed when a critical index exists under the right name with the wrong key', async () => {
  const result = await checkCmsSchemaReadiness(payloadWith({
    mutateIndex: (index) => index.name === 'operation_queue_order'
      ? { ...index, key: { collectionId: 1, status: 1, operationSequence: 1 } }
      : index,
  }) as never)

  expect(result).toEqual(expect.objectContaining({
    ready: false,
    indexes: 'missing',
    missingIndexes: ['collection-operations:operation_queue_order'],
  }))
})

test('fails closed when heartbeat TTL has the right name but unsafe expiry', async () => {
  const result = await checkCmsSchemaReadiness(payloadWith({
    mutateIndex: (index) => index.name === 'worker_heartbeat_ttl'
      ? { ...index, expireAfterSeconds: 60 }
      : index,
  }) as never)

  expect(result).toEqual(expect.objectContaining({
    ready: false,
    indexes: 'missing',
    missingIndexes: ['worker-heartbeats:worker_heartbeat_ttl'],
  }))
})

test('fails closed when required uniqueness is absent', async () => {
  const result = await checkCmsSchemaReadiness(payloadWith({
    mutateIndex: (index) => index.name === 'audit_archive_batch_unique'
      ? { ...index, unique: false }
      : index,
  }) as never)

  expect(result).toEqual(expect.objectContaining({
    ready: false,
    indexes: 'missing',
    missingIndexes: ['audit-archive-manifests:audit_archive_batch_unique'],
  }))
})
