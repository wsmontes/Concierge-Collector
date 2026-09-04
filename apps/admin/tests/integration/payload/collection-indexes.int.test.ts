import { describe, expect, test } from 'vitest'
import { cmsDb } from '../support/cms-db'

const integrationSuite = process.env.CMS_SKIP_MONGO_INTEGRATION === '1' ? describe.skip : describe

integrationSuite('Collections CMS indexes', () => {
  test('protege slug, interval aberto, staging e filas', async () => {
    const indexes = async (collection: string) => cmsDb.collection(collection).listIndexes().toArray()
    const names = async (collection: string) => (await indexes(collection)).map((index) => index.name)
    const byName = async (collection: string, name: string) =>
      (await indexes(collection)).find((index) => index.name === name)

    expect(await names('collections')).toContain('collections_slug_unique')
    expect(await names('collection_memberships')).toEqual(
      expect.arrayContaining(['membership_interval_unique', 'membership_open_unique', 'membership_by_curation']),
    )
    expect(await byName('collection_memberships', 'membership_open_unique')).toMatchObject({
      key: { collectionId: 1, curationId: 1 },
      unique: true,
      partialFilterExpression: { removedInVersion: null },
    })
    expect(await names('collection_draft_changes')).toEqual(expect.arrayContaining([
      'draft_change_item_unique',
      'draft_changes_by_stage',
    ]))
    expect(await names('collection_operations')).toEqual(
      expect.arrayContaining([
        'operation_idempotency_unique',
        'operation_job_unique',
        'operation_queue_order',
        'operation_lease_expiry',
        'operation_retention_scan',
      ]),
    )
    expect(await byName('collection_operations', 'operation_queue_order')).toMatchObject({
      key: { collectionId: 1, operationSequence: 1, status: 1 },
    })
    expect(await byName('collection_operations', 'operation_job_unique')).toMatchObject({
      key: { jobId: 1 },
      unique: true,
    })
    expect(await byName('collection_operations', 'operation_retention_scan')).toMatchObject({
      key: { status: 1, updatedAt: 1 },
    })
    expect(await names('collection_publish_jobs')).toContain('publish_lease_expiry')

    expect(await byName('collection_exports', 'export_artifact_ttl')).toBeUndefined()
    expect(await byName('collection_exports', 'export_expiry_status')).toMatchObject({
      key: { expiresAt: 1, status: 1 },
    })

    expect(await byName('audit_events', 'audit_archive_scan')).toMatchObject({
      key: { createdAt: 1, _id: 1 },
    })
    expect(await byName('audit_archive_manifests', 'audit_archive_batch_unique')).toMatchObject({
      key: { batchKey: 1 },
      unique: true,
    })
  })
})
