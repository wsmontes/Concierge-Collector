import { describe, expect, test } from 'vitest'
import { CMS_NAV_GROUPS } from '../../../src/components/shell/CmsNav'

describe('CMS navigation', () => {
  test('does not anticipate empty modules', () => {
    expect(CMS_NAV_GROUPS.map((group) => group.label)).toEqual([
      'Overview',
      'Content',
      'Distribution',
      'Operations',
      'Administration',
    ])
    expect(JSON.stringify(CMS_NAV_GROUPS)).not.toContain('Entities')
  })
})
