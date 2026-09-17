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
  })

  test('leaves the legacy Explorer path to the redirect that owns it', () => {
    // `/admin/explorer` continua registrado como view de compatibilidade que
    // redireciona para `/admin/curations` — nenhum item de nav deve acendê-lo.
    expect(activeLabels('/admin/explorer')).toEqual([])
  })

  test('não acende nada numa superfície que não é de produto', () => {
    // As listas NATIVAS das collections internas saíram do menu: o operador vê
    // `Applications`, que é a superfície de produto do mesmo domínio. Chegar
    // nelas por URL direta não deve acender item nenhum.
    expect(activeLabels('/admin/collections/consumer-applications')).toEqual([])
    expect(activeLabels('/admin/collections/consumer-credentials/abc')).toEqual([])
    expect(activeLabels('/admin/collections/cms-users')).toEqual([])
    // `/admin` é prefixo de toda a área: sem `exact` o Dashboard ficaria ativo em tudo.
    expect(activeLabels('/admin/collections')).toEqual([])
  })

  test('a navegação não expõe o modelo de armazenamento do CMS', () => {
    const hrefs = CMS_NAV_GROUPS.flatMap((group) => group.items).map((item) => item.href)
    const labels = CMS_NAV_GROUPS.flatMap((group) => group.items).map((item) => item.label)
    // Vazamento tem três formas concretas: o sufixo "(records)" que dizia qual
    // tabela estava por trás, um slug cru (`consumer-credentials`, `cms_users`) e
    // um rótulo que repetisse o nome interno. "Collections" é vocabulário de
    // PRODUTO e fica: o que não fica é o nome da coleção do CMS.
    expect(labels.filter((label) => /\(records\)|_/.test(label))).toEqual([])
    expect(labels.filter((label) => /^[a-z][a-z-]*$/.test(label))).toEqual([])
    expect(hrefs.filter((href) => href.startsWith('/admin/collections/'))).toEqual([
      '/admin/collections/collections',
    ])
  })
})
