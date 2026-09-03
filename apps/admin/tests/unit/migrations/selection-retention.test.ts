import { expect, test, vi } from 'vitest'
import { up } from '../../../src/migrations/20260902_010_selection_retention'

function collection() {
  return {
    dropIndex: vi.fn().mockResolvedValue(undefined),
    createIndex: vi.fn().mockResolvedValue('ok'),
  }
}

test('replaces unconditional selection TTL with unused and retained TTL policies', async () => {
  const manifests = collection()
  const items = collection()
  const operations = { distinct: vi.fn().mockResolvedValue(['selection-used']) }
  const exportsModel = { distinct: vi.fn().mockResolvedValue([]) }
  const manifestUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const itemUpdate = vi.fn().mockResolvedValue({ modifiedCount: 2 })
  const payload = {
    db: {
      name: 'mongoose',
      collections: {
        'selection-manifests': { collection: { ...manifests, updateMany: manifestUpdate } },
        'selection-manifest-items': { collection: { ...items, updateMany: itemUpdate } },
        'collection-operations': { collection: operations },
        'collection-exports': { collection: exportsModel },
      },
    },
  }

  await up({ payload } as never)

  expect(manifests.dropIndex).toHaveBeenCalledWith('selection_manifest_ttl')
  expect(items.dropIndex).toHaveBeenCalledWith('selection_item_ttl')
  expect(manifests.createIndex).toHaveBeenCalledWith(
    { expiresAt: 1 },
    expect.objectContaining({
      name: 'selection_manifest_unused_ttl',
      expireAfterSeconds: 0,
      partialFilterExpression: { retainedUntil: null },
    }),
  )
  expect(manifests.createIndex).toHaveBeenCalledWith(
    { retainedUntil: 1 },
    { name: 'selection_manifest_retained_ttl', expireAfterSeconds: 0 },
  )
  expect(items.createIndex).toHaveBeenCalledWith(
    { expiresAt: 1 },
    expect.objectContaining({
      name: 'selection_item_unused_ttl',
      expireAfterSeconds: 0,
      partialFilterExpression: { retainedUntil: null },
    }),
  )
  expect(items.createIndex).toHaveBeenCalledWith(
    { retainedUntil: 1 },
    { name: 'selection_item_retained_ttl', expireAfterSeconds: 0 },
  )
  expect(manifestUpdate).toHaveBeenCalledTimes(1)
  expect(itemUpdate).toHaveBeenCalledTimes(1)
})
