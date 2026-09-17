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
  /**
   * Chave do ícone do grupo, resolvida em `CmsIcons.NAV_ICONS`. Chave string (e
   * não o componente) para que este módulo continue sem import nenhum — é o que
   * permite um teste conferir os grupos sem carregar o bundle de UI do Payload.
   */
  icon: string
}

/**
 * Dados puros, sem import nenhum: `CmsNav.tsx` puxa `@payloadcms/next/client`,
 * que arrasta o bundle de UI do Payload (e CSS de terceiros). Um teste que só
 * quer conferir os grupos não deve precisar carregar nada disso.
 */
export const CMS_NAV_GROUPS: readonly CmsNavGroup[] = [
  {
    label: 'Overview',
    icon: 'dashboard',
    items: [{ href: '/admin', label: 'Dashboard', exact: true }],
  },
  {
    label: 'Content',
    icon: 'curations',
    items: [
      { href: '/admin/curations', label: 'Curations' },
      { href: '/admin/entities', label: 'Entities' },
      { href: '/admin/collections/collections', label: 'Collections' },
    ],
  },
  {
    label: 'Distribution',
    icon: 'applications',
    items: [
      // Uma porta só para o domínio de distribuição. Antes havia três itens, dois
      // deles apontando para as listas NATIVAS das collections internas
      // (`consumer-applications (records)`, `consumer-credentials (records)`) —
      // o modelo de armazenamento do CMS aparecendo no menu, com dois lugares
      // diferentes para a mesma pergunta. A tela `Applications` é a superfície
      // de produto e cobre aplicações e credenciais.
      { href: '/admin/applications', label: 'Applications' },
    ],
  },
  {
    label: 'Operations',
    icon: 'operations',
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
