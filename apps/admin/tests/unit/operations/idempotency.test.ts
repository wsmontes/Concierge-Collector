import { describe, expect, test } from 'vitest'
import { draftOperationRequestHash, normalizeExplicitCurationIds } from '../../../src/operations/idempotency'

describe('draft operation idempotency', () => {
  test('hashes only normalized stable command input', () => {
    const first = draftOperationRequestHash({
      collectionId: '0123456789abcdef01234567',
      action: 'add',
      baseDraftRevision: 3,
      curationIds: ['c2', 'c1', 'c2'],
    })
    const retry = draftOperationRequestHash({
      baseDraftRevision: 3,
      action: 'add',
      curationIds: ['c2', 'c1'],
      collectionId: '0123456789abcdef01234567',
    })

    expect(retry).toBe(first)
    expect(normalizeExplicitCurationIds(['c2', 'c1', 'c2'])).toEqual(['c2', 'c1'])
  })
})
