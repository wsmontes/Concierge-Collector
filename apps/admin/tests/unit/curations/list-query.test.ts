import { describe, expect, test } from 'vitest'
import { readCurationListQuery, writeCurationListQuery } from '../../../src/curations/list-query'

describe('Curation list URL state', () => {
  test('round-trips the filters the server accepts', () => {
    const filters = {
      q: 'ritz',
      city: 'São Paulo',
      entity_type: 'restaurant',
      curator_id: 'wagner',
      status: ['active', 'linked'],
    }

    expect(readCurationListQuery(new URLSearchParams(writeCurationListQuery(filters)))).toEqual(filters)
  })

  test('omits empty filters so a cleared search does not survive as "?q="', () => {
    expect(writeCurationListQuery({ q: '', city: undefined, status: [] })).toBe('')
    expect(writeCurationListQuery({ q: 'ritz' })).toBe('q=ritz')
  })

  test('reads repeated status parameters, not just the first', () => {
    const query = readCurationListQuery(new URLSearchParams('status=active&status=draft&q=ritz'))

    expect(query.status).toEqual(['active', 'draft'])
    expect(query.q).toBe('ritz')
  })

  test('treats a single status parameter as a one-element filter list', () => {
    expect(readCurationListQuery(new URLSearchParams('status=active')).status).toEqual(['active'])
  })
})
