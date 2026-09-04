import { describe, expect, test } from 'vitest'
import {
  grantableCollectionFilter,
  newlyAddedCollectionIds,
} from '../../../src/applications/allowlist'

describe('consumer application collection allowlist policy', () => {
  test('create grant filter accepts only published Collections with a published version', () => {
    expect(grantableCollectionFilter(['64f000000000000000000001'])).toEqual({
      _id: { $in: ['64f000000000000000000001'] },
      lifecycle: 'published',
      currentPublishedVersion: { $type: 'number' },
    })
  })

  test('patch validates only ids that were not already granted', () => {
    expect(newlyAddedCollectionIds(
      ['64f000000000000000000000001', '64f000000000000000000000002'],
      ['64f000000000000000000000002', '64f000000000000000000000003', '64f000000000000000000000003'],
    )).toEqual(['64f000000000000000000000003'])
  })

  test('removal never produces a collection grant to validate', () => {
    expect(newlyAddedCollectionIds(
      ['64f000000000000000000000001', '64f000000000000000000000002'],
      ['64f000000000000000000000001'],
    )).toEqual([])
  })
})
