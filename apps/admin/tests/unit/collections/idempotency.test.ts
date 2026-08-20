import { describe, expect, test } from 'vitest'
import { collectionCommandHash, collectionCommandKey } from '../../../src/collections/idempotency'

describe('Collection lifecycle command idempotency', () => {
  test('hashes the normalized command deterministically and keys it by command scope', () => {
    const first = collectionCommandHash({
      actorId: 'admin-1',
      command: 'patch',
      collectionId: '0123456789abcdef01234567',
      ifMatch: 3,
      metadata: { title: 'Sushi', slug: 'sushi-sp' },
    })
    const same = collectionCommandHash({
      metadata: { slug: 'sushi-sp', title: 'Sushi' },
      ifMatch: 3,
      collectionId: '0123456789abcdef01234567',
      command: 'patch',
      actorId: 'admin-1',
    })

    expect(same).toBe(first)
    expect(collectionCommandKey('collection:0123456789abcdef01234567', 'request-key'))
      .toBe(collectionCommandKey('collection:0123456789abcdef01234567', 'request-key'))
    expect(collectionCommandKey('collection:0123456789abcdef01234567', 'request-key'))
      .not.toBe(collectionCommandKey('collection:0123456789abcdef01234567', 'another-key'))
  })
})
