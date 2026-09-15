export interface CmsNavItem {
  /**
   * Casa só este path. Sem isso o item também fica ativo em qualquer path
   * abaixo dele — necessário para `/admin`, que é prefixo de todas as telas.
   */
  exact?: boolean
  href: string
  label: string
}

export interface CmsNavGroup {
  items: CmsNavItem[]
  label: 'Overview' | 'Content' | 'Distribution' | 'Operations'
}

/**
 * Dados puros, sem import nenhum: `CmsNav.tsx` puxa `@payloadcms/next/client`,
 * que arrasta o bundle de UI do Payload (e CSS de terceiros). Um teste que só
 * quer conferir os grupos não deve precisar carregar nada disso.
 */
export const CMS_NAV_GROUPS: readonly CmsNavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard', exact: true }],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/curations', label: 'Curations' },
      { href: '/admin/entities', label: 'Entities' },
      { href: '/admin/collections/collections', label: 'Collections' },
    ],
  },
  {
    label: 'Distribution',
    items: [
      { href: '/admin/applications', label: 'Applications' },
      { href: '/admin/collections/consumer-applications', label: 'Consumer Applications (records)' },
      { href: '/admin/collections/consumer-credentials', label: 'Consumer Credentials (records)' },
    ],
  },
  {
    label: 'Operations',
    items: [{ href: '/admin/operations', label: 'Operations' }],
  },
]

/**
 * O detalhe de uma Collection (`/admin/collections/collections/<id>`) mantém
 * Collections ativo, mas `/admin/collections/consumer-applications` NÃO pode
 * ativar Collections: daí a barra exigir o segmento inteiro, e não um
 * `startsWith` cru.
 */
export function isNavItemActive(item: CmsNavItem, pathname: string): boolean {
  if (pathname === item.href) return true
  return !item.exact && pathname.startsWith(`${item.href}/`)
}
