import { expect, test, vi } from 'vitest'
import { up } from '../../../src/migrations/20260902_010_selection_retention'

function rawCollection() {
  return {
    dropIndex: vi.fn().mockResolvedValue(undefined),
    createIndex: vi.fn().mockResolvedValue('ok'),
  }
}

test('replaces unconditional selection TTL with unused and retained TTL policies', async () => {
  const manifestRaw = rawCollection()
  const itemRaw = rawCollection()
  const manifestUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 })
  const itemUpdate = vi.fn().mockResolvedValue({ modifiedCount: 2 })
  const operationDistinct = vi.fn().mockResolvedValue(['65f000000000000000000001'])
  const exportDistinct = vi.fn().mockResolvedValue([])
  const payload = {
    db: {
      name: 'mongoose',
      collections: {
        'selection-manifests': { collection: manifestRaw, updateMany: manifestUpdate },
        'selection-manifest-items': { collection: itemRaw, updateMany: itemUpdate },
        'collection-operations': { distinct: operationDistinct },
        'collection-exports': { distinct: exportDistinct },
      },
    },
  }

  await up({ payload } as never)

  expect(manifestRaw.dropIndex).toHaveBeenCalledWith('selection_manifest_ttl')
  expect(itemRaw.dropIndex).toHaveBeenCalledWith('selection_item_ttl')
  expect(manifestRaw.createIndex).toHaveBeenCalledWith(
    { expiresAt: 1 },
    expect.objectContaining({
      name: 'selection_manifest_unused_ttl',
      expireAfterSeconds: 0,
      partialFilterExpression: { retainedUntil: null },
    }),
  )
  expect(manifestRaw.createIndex).toHaveBeenCalledWith(
    { retainedUntil: 1 },
    { name: 'selection_manifest_retained_ttl', expireAfterSeconds: 0 },
  )
  expect(itemRaw.createIndex).toHaveBeenCalledWith(
    { expiresAt: 1 },
    expect.objectContaining({
      name: 'selection_item_unused_ttl',
      expireAfterSeconds: 0,
      partialFilterExpression: { retainedUntil: null },
    }),
  )
  expect(itemRaw.createIndex).toHaveBeenCalledWith(
    { retainedUntil: 1 },
    { name: 'selection_item_retained_ttl', expireAfterSeconds: 0 },
  )
  expect(operationDistinct).toHaveBeenCalledWith('selectionId', { selectionId: { $type: 'string' } })
  expect(manifestUpdate).toHaveBeenCalledTimes(1)
  expect(itemUpdate).toHaveBeenCalledTimes(1)
})
