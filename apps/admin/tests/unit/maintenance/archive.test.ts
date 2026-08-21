import { describe, expect, test } from 'vitest'

import { archiveBatch } from '../../../src/maintenance/archive'

describe('retention archive', () => {
  test('persists a verified manifest before deleting exact source ids', async () => {
    const calls: string[] = []
    const docs = [
      { _id: 'a', createdAt: new Date('2025-01-01T00:00:00Z'), eventType: 'one' },
      { _id: 'b', createdAt: new Date('2025-01-02T00:00:00Z'), eventType: 'two' },
    ]
    const result = await archiveBatch({
      kind: 'audit_events',
      sourceCollection: 'audit-events',
      docs,
      now: new Date('2026-08-20T12:00:00Z'),
      put: async ({ bytes, key }) => {
        calls.push('put')
        expect(bytes.byteLength).toBeGreaterThan(0)
        return { key: `private/${key}`, sha256: 'a'.repeat(64) }
      },
      persistManifestAndDelete: async ({ manifest, ids }) => {
        calls.push('manifest+delete')
        expect(manifest.count).toBe(2)
        expect(manifest.sha256).toBe('a'.repeat(64))
        expect(ids).toEqual(['a', 'b'])
      },
    })

    expect(calls).toEqual(['put', 'manifest+delete'])
    expect(result.count).toBe(2)
  })

  test('never calls delete transaction if object upload fails', async () => {
    let deleted = false
    await expect(archiveBatch({
      kind: 'operation_items',
      sourceCollection: 'collection-operation-items',
      docs: [{ _id: 'a', createdAt: new Date() }],
      now: new Date(),
      put: async () => { throw new Error('storage unavailable') },
      persistManifestAndDelete: async () => { deleted = true },
    })).rejects.toThrow('storage unavailable')
    expect(deleted).toBe(false)
  })
})
