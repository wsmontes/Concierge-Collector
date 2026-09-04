import { expect, test, vi } from 'vitest'
import { checkCmsSchemaReadiness, LATEST_CMS_MIGRATION } from '../../../src/operations/schema-readiness'

function model(indexNames: string[] = []) {
  return {
    collection: { indexes: vi.fn().mockResolvedValue(indexNames.map((name) => ({ name }))) },
  }
}

function payloadWith(input: { migration?: boolean; missingIndex?: string } = {}) {
  const required: Record<string, string[]> = {
    collections: ['collections_slug_unique'],
    'collection-operations': ['operation_queue_order', 'operation_retention_scan'],
    'collection-publish-jobs': ['publish_lease_expiry'],
    'collection-exports': ['export_expiry_status'],
    'audit-events': ['audit_archive_scan'],
    'audit-archive-manifests': ['audit_archive_batch_unique'],
    'worker-heartbeats': ['worker_heartbeat_ttl'],
  }
  const collections: Record<string, unknown> = {
    'payload-migrations': {
      findOne: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(input.migration === false ? null : { name: LATEST_CMS_MIGRATION }),
      }),
    },
  }
  for (const [slug, names] of Object.entries(required)) {
    collections[slug] = model(names.filter((name) => name !== input.missingIndex))
  }
  return { db: { collections } }
}

test('latest migration marker remains audit archival while readiness also checks older critical TTLs', () => {
  expect(LATEST_CMS_MIGRATION).toBe('20260904_013_audit_archival')
})

test('reports ready only when latest migration and critical indexes are present', async () => {
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

test('fails closed when worker heartbeat TTL index is missing', async () => {
  const result = await checkCmsSchemaReadiness(payloadWith({ missingIndex: 'worker_heartbeat_ttl' }) as never)

  expect(result).toEqual(expect.objectContaining({
    ready: false,
    indexes: 'missing',
    missingIndexes: ['worker-heartbeats:worker_heartbeat_ttl'],
  }))
})
