import { expect, test } from 'vitest'
import {
  parseEntityListState,
  serializeEntityListState,
} from '../../../../src/components/entities/entity-url-state'

test('parses only the list keys and treats a blank one as absent', () => {
  expect(parseEntityListState('?q=%20ritz%20&type=restaurant&status=&cursor=')).toEqual({
    q: 'ritz',
    type: 'restaurant',
    status: null,
    cursor: null,
  })
  expect(parseEntityListState('')).toEqual({ q: '', type: null, status: null, cursor: null })
})

test('re-emits foreign keys first and drops the keys the list owns', () => {
  expect(serializeEntityListState(
    { q: 'ritz', type: 'restaurant', status: null, cursor: null },
    '?utm=x&q=old&status=draft',
  )).toBe('?utm=x&q=ritz&type=restaurant')

  expect(serializeEntityListState({ q: '', type: null, status: null, cursor: null }, '?q=old')).toBe('')
})
