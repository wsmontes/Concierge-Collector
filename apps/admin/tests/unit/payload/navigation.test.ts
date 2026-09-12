import { describe, expect, test } from 'vitest'
import { CMS_NAV_GROUPS } from '../../../src/components/shell/CmsNav'

describe('CMS navigation', () => {
  test('does not anticipate empty modules', () => {
    expect(CMS_NAV_GROUPS.map((group) => group.label)).toEqual([
      'Overview',
      'Content',
      'Distribution',
      'Operations',
    ])
    expect(JSON.stringify(CMS_NAV_GROUPS)).not.toContain('Entities')
    // A caixa "…will appear here when available." só existia nos grupos vazios.
    // Nenhum grupo pode voltar a ser vazio.
    expect(CMS_NAV_GROUPS.every((group) => group.items.length > 0)).toBe(true)
  })
})
