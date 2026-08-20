import { describe, expect, test } from 'vitest'
import { draftDeltaTransition, convergeDraftDelta } from '../../../src/collections/draft-delta'

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

  test.each([
    [false, null, 'remove', null, false],
    [true, null, 'add', null, false],
    [false, 'add', 'add', 'add', false],
    [true, 'remove', 'remove', 'remove', false],
    [false, 'add', 'remove', null, true],
    [true, 'remove', 'add', null, true],
    [false, null, 'add', 'add', true],
    [true, null, 'remove', 'remove', true],
  ] as const)('classifies published=%s current=%s action=%s', (published, current, action, desired, changed) => {
    expect(draftDeltaTransition(published, current, action)).toEqual({ desired, changed })
  })
})