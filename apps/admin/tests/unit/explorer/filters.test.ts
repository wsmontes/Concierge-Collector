import { describe, expect, test } from 'vitest'
import { hashNormalizedFilters, normalizeCurationFilters } from '../../../src/explorer/normalize-filters'

describe('Curation Explorer filters', () => {
  test('normalizes equivalent filter input into the same canonical value and hash', async () => {
    const first = normalizeCurationFilters({ q: '  Sushi ', status: ['active', 'draft', 'active'] })
    const second = normalizeCurationFilters({ q: 'sushi', status: ['draft', 'active'] })

    expect(first).toEqual(second)
    await expect(hashNormalizedFilters(first)).resolves.toBe(await hashNormalizedFilters(second))
  })
})
