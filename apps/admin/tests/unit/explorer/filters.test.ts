import { describe, expect, test } from 'vitest'
import { hashNormalizedFilters, normalizeCurationFilters } from '../../../src/explorer/normalize-filters'

describe('Curation Explorer filters', () => {
  test('normalizes equivalent filter input into the same canonical value and hash', async () => {
    const first = normalizeCurationFilters({ q: '  Sushi ', status: ['active', 'draft', 'active'] })
    const second = normalizeCurationFilters({ q: 'sushi', status: ['draft', 'active'] })

    expect(first).toEqual(second)
    await expect(hashNormalizedFilters(first)).resolves.toBe(await hashNormalizedFilters(second))
  })

  test('canonicalizes concept facets so an all-matching intent carries them deterministically', async () => {
    const first = normalizeCurationFilters({
      concepts: [{ category: ' Mood ', value: 'Casual' }, { category: 'Cuisine', value: 'Italian' }],
    })
    const second = normalizeCurationFilters({
      concepts: [{ category: 'Cuisine', value: 'Italian' }, { category: 'Mood', value: 'Casual' }, { category: 'Mood', value: 'Casual' }, { category: '', value: 'ignored' }],
    })

    expect(first).toEqual(second)
    expect(first.concepts).toEqual([
      { category: 'Cuisine', value: 'Italian' },
      { category: 'Mood', value: 'Casual' },
    ])
    await expect(hashNormalizedFilters(first)).resolves.toBe(await hashNormalizedFilters(second))
  })

  test('omits the concept key entirely when no facet is present', () => {
    expect(normalizeCurationFilters({ q: 'sushi' })).toEqual({ q: 'sushi' })
    expect(normalizeCurationFilters({ concepts: [] })).toEqual({})
  })
})
