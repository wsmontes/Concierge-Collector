import { describe, expect, test } from 'vitest'
import { convergeDraftDelta } from '../../../src/collections/draft-delta'

describe('draft delta convergence', () => {
  test.each([
    [false, null, 'add', 'add'],
    [true, null, 'remove', 'remove'],
    [false, 'add', 'remove', null],
    [true, 'remove', 'add', null],
    [false, 'add', 'add', 'add'],
    [true, 'remove', 'remove', 'remove'],
  ] as const)('converges published=%s current=%s action=%s', (published, current, action, expected) => {
    expect(convergeDraftDelta(published, current, action)).toBe(expected)
  })
})
