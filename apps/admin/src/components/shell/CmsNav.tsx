import { NavHamburger, NavWrapper } from '@payloadcms/next/client'
import type { ReactNode } from 'react'
import { CmsNavLinks } from './CmsNavLinks'
import { CMS_NAV_GROUPS } from './nav-groups'

function Brand({ children }: { children: ReactNode }) {
  return <span className="cms-brand">{children}</span>
}

export function CmsIcon() {
  return <Brand>CC</Brand>
}

export function CmsLogo() {
  return <Brand>Concierge Collector</Brand>
}

/**
 * `components.Nav` substitui o `DefaultNav` INTEIRO — inclusive a casca que ele
 * desenha (`aside.nav` + `nav__scroll` + `nav__wrap`). Sem essas classes o CSS do
 * Payload não casa em nada: a coluna do grid `.template-default` fica em 0 e a
 * sidebar transborda sobre o conteúdo, os itens saem como lista com marcador e
 * sublinhado, e o hambúrguer não tem estado para alternar (`nav--nav-open`, que o
 * `NavWrapper` liga ao `useNav`).
 *
 * Por isso a casca vem do próprio `NavWrapper` (exportado em
 * `@payloadcms/next/client`) em vez de ser reescrita à mão: largura, altura,
 * `overflow`, `inert` quando fechada e a transição passam a ser as nativas.
 */
export function CmsNav() {
  return (
    <NavWrapper baseClass="nav">
      <nav aria-label="Concierge CMS" className="nav__wrap">
        <CmsNavLinks groups={CMS_NAV_GROUPS} />
      </nav>
      <div className="nav__header">
        <div className="nav__header-content">
          <NavHamburger baseClass="nav" />
        </div>
      </div>
    </NavWrapper>
  )
}
