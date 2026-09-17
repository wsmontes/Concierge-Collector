'use client'

import { NavHamburger, NavWrapper } from '@payloadcms/next/client'
import { useAuth, useTheme } from '@payloadcms/ui'
import type { ReactNode } from 'react'
import { CmsNavLinks } from './CmsNavLinks'
import { CMS_NAV_GROUPS } from './nav-groups'
import { IconKeyboard, IconMoon, IconSearch, IconSun } from './CmsIcons'
import { useAdminUi } from './AdminUiContext'
import { Menu, type MenuItemSpec } from '../ui/Menu'

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
 * Bloco de conta no rodapé da navegação: quem está operando e as saídas.
 *
 * Isto fechava uma lacuna real — o `DefaultNav` do Payload hospeda
 * `nav__controls` (configurações + logout) e a navegação própria não reproduzia
 * esse bloco, então **não havia logout na sidebar**. O logout é um POST para
 * `/auth/logout` (o cookie de sessão é HttpOnly: só o servidor pode apagá-lo e
 * revogar a sessão no banco), daí o item por `submit` em vez de `onSelect`.
 */
function NavAccount() {
  const { user } = useAuth()
  const { theme, setTheme } = useTheme()
  const { openShortcuts } = useAdminUi()

  const email = typeof user?.email === 'string' ? user.email : ''
  const name = typeof user?.name === 'string' && user.name.length > 0 ? user.name : email
  const initial = (name || '?').trim().charAt(0).toLocaleUpperCase()

  const items: MenuItemSpec[] = [
    { label: 'Account settings', onSelect: () => window.location.assign('/admin/account') },
    {
      hint: theme === 'dark' ? 'light' : 'dark',
      label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      onSelect: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    },
    { label: 'Keyboard shortcuts', hint: '?', onSelect: openShortcuts },
    { separator: true },
    { label: 'Log out', submit: { action: '/auth/logout' }, tone: 'danger' },
  ]

  return (
    <div className="cms-nav__account">
      <Menu
        align="top"
        items={items}
        label="Account"
        trigger={
          <span className="cms-nav__account-trigger">
            <span aria-hidden="true" className="cms-nav__avatar">
              {initial}
            </span>
            <span className="cms-nav__account-id">
              <span className="cms-nav__account-name">{name || 'Signed in'}</span>
              {email && <span className="cms-nav__account-email">{email}</span>}
            </span>
          </span>
        }
      />
    </div>
  )
}

/**
 * A navegação do CMS.
 *
 * `components.Nav` substitui o `DefaultNav` INTEIRO — inclusive a casca que ele
 * desenha (`aside.nav` + `nav__scroll` + `nav__wrap`). Sem essas classes o CSS do
 * Payload não casa em nada: a coluna do grid `.template-default` fica em 0 e a
 * sidebar transborda sobre o conteúdo, os itens saem como lista com marcador e
 * sublinhado, e o hambúrguer não tem estado para alternar (`nav--nav-open`, que o
 * `NavWrapper` liga ao `useNav`).
 *
 * Por isso a casca continua vindo do próprio `NavWrapper` (exportado em
 * `@payloadcms/next/client`) em vez de ser reescrita à mão: largura, altura,
 * `overflow`, `inert` quando fechada e a transição passam a ser as nativas. O
 * que é nosso é o conteúdo: marca, pílula de busca, grupos e o bloco de conta.
 */
export function CmsNav() {
  const { openPalette } = useAdminUi()

  return (
    <NavWrapper baseClass="nav">
      <nav aria-label="Concierge CMS" className="nav__wrap cms-nav">
        <div className="cms-nav__brand">
          <CmsLogo />
          <p className="cms-nav__tagline">Editorial CMS</p>
        </div>

        <button className="cms-nav__search" onClick={openPalette} type="button">
          <IconSearch />
          <span className="cms-nav__search-label">Search or jump to</span>
          <kbd className="ui-keyhint">⌘K</kbd>
        </button>

        <div className="cms-nav__groups">
          <CmsNavLinks groups={CMS_NAV_GROUPS} />
        </div>

        <NavAccount />
      </nav>
      <div className="nav__header">
        <div className="nav__header-content">
          <NavHamburger baseClass="nav" />
        </div>
      </div>
    </NavWrapper>
  )
}

/**
 * Ações do cabeçalho (slot `admin.components.actions`): busca, tema e ajuda.
 * Ficam no topo à direita porque agem sobre a tela inteira, não sobre uma lista.
 */
export function CmsHeaderActions() {
  const { openPalette, openShortcuts } = useAdminUi()
  const { theme, setTheme } = useTheme()

  return (
    <div className="cms-header-actions">
      <button aria-label="Open command palette" className="cms-header-actions__button" onClick={openPalette} type="button">
        <IconSearch />
      </button>
      <button aria-label="Show keyboard shortcuts" className="cms-header-actions__button" onClick={openShortcuts} type="button">
        <IconKeyboard />
      </button>
      <button
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        className="cms-header-actions__button"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        type="button"
      >
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
      </button>
    </div>
  )
}
