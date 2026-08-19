import { describe, expect, test } from 'vitest'
import { isMemberAtVersion } from '../../../src/collections/membership'

describe('membership intervals', () => {
  test('closed interval is a member only before removedInVersion', () => {
    const interval = { addedInVersion: 2, removedInVersion: 5 }

    expect([1, 2, 4, 5].map((version) => isMemberAtVersion(interval, version)))
      .toEqual([false, true, true, false])
  })

  test('open interval remains a member from addedInVersion onward', () => {
    const interval = { addedInVersion: 2, removedInVersion: null }

    expect([1, 2, 999].map((version) => isMemberAtVersion(interval, version)))
      .toEqual([false, true, true])
  })
})
