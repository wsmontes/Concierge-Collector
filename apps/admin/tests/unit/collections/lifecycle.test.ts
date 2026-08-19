import { describe, expect, test } from 'vitest'
import { decideLifecycle, normalizeCollectionSlug, normalizeCollectionTitle } from '../../../src/collections/lifecycle'

describe('Collection lifecycle', () => {
  test.each([
    ['draft', false, 'delete', 'hard-delete'],
    ['published', true, 'delete', 'reject'],
    ['published', true, 'archive', 'archived'],
    ['archived', true, 'restore', 'published'],
    ['archived', true, 'patch', 'reject'],
  ] as const)('%s + %s + %s -> %s', (lifecycle, everPublished, command, result) => {
    expect(decideLifecycle({ lifecycle, everPublished }, command)).toBe(result)
  })

  test('slug publicado nunca muda', () => {
    expect(() => decideLifecycle(
      { lifecycle: 'published', everPublished: true, slug: 'a' },
      'patch', { slug: 'b' },
    )).toThrow('slug_immutable')
  })

  test('normaliza título e rejeita título ou slug vazios', () => {
    expect(normalizeCollectionTitle('  Sushi em São Paulo  ')).toBe('Sushi em São Paulo')
    expect(() => normalizeCollectionTitle('   ')).toThrow('title_invalid')
    expect(() => normalizeCollectionSlug('---')).toThrow('slug_invalid')
  })
})
