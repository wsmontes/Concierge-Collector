import { describe, expect, test } from 'vitest'
import { CMS_NAV_GROUPS, isNavItemActive } from '../../../src/components/shell/nav-groups'

describe('CMS navigation', () => {
  test('exposes the four editorial sections with no empty module', () => {
    expect(CMS_NAV_GROUPS.map((group) => group.label)).toEqual([
      'Overview',
      'Content',
      'Distribution',
      'Operations',
    ])
    // A caixa "…will appear here when available." só existia nos grupos vazios.
    // Nenhum grupo pode voltar a ser vazio.
    expect(CMS_NAV_GROUPS.every((group) => group.items.length > 0)).toBe(true)
    expect(CMS_NAV_GROUPS.find((group) => group.label === 'Content')?.items.map((item) => item.href)).toEqual([
      '/admin/curations',
      '/admin/entities',
      '/admin/collections/collections',
    ])
  })
})

const activeLabels = (pathname: string): string[] =>
  CMS_NAV_GROUPS.flatMap((group) => group.items)
    .filter((item) => isNavItemActive(item, pathname))
    .map((item) => item.label)

describe('active item', () => {
  test('highlights the section that owns the route', () => {
    expect(activeLabels('/admin')).toEqual(['Dashboard'])
    expect(activeLabels('/admin/curations')).toEqual(['Curations'])
    expect(activeLabels('/admin/entities')).toEqual(['Entities'])
    expect(activeLabels('/admin/applications')).toEqual(['Applications'])
    expect(activeLabels('/admin/operations')).toEqual(['Operations'])
  })

  test('keeps the section lit on its nested routes', () => {
    expect(activeLabels('/admin/collections/collections/507f1f77bcf86cd799439011')).toEqual(['Collections'])
    expect(activeLabels('/admin/curations/507f1f77bcf86cd799439011')).toEqual(['Curations'])
    expect(activeLabels('/admin/entities/507f1f77bcf86cd799439011')).toEqual(['Entities'])
    expect(activeLabels('/admin/collections/consumer-credentials/abc')).toEqual([
      'Consumer Credentials (records)',
    ])
  })

  test('leaves the legacy Explorer path to the redirect that owns it', () => {
    // `/admin/explorer` continua registrado como view de compatibilidade que
    // redireciona para `/admin/curations` — nenhum item de nav deve acendê-lo.
    expect(activeLabels('/admin/explorer')).toEqual([])
  })

  test('never lights a sibling collection or the dashboard', () => {
    // `/admin` é prefixo de toda a área: sem `exact` o Dashboard ficaria ativo em tudo.
    expect(activeLabels('/admin/collections/consumer-applications')).toEqual([
      'Consumer Applications (records)',
    ])
    expect(activeLabels('/admin/collections')).toEqual([])
  })
})
