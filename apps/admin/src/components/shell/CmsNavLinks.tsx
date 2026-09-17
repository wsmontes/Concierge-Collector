'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ICONS } from './CmsIcons'
import { isNavItemActive, type CmsNavGroup } from './nav-groups'

/**
 * Os itens usam as classes `nav__link`/`nav__link-indicator` do Payload de
 * propósito: é o CSS dele que dá display, altura de linha, hover e o traço do
 * item ativo. Um `<a>` cru aqui vira lista com marcador e sublinhado.
 *
 * `Link` e não `<a>`: um `<a>` recarregaria o documento inteiro a cada clique,
 * perdendo scroll, estado e o próprio app.
 *
 * O ícone é do grupo, não do item: seis ícones diferentes em nove itens viram
 * ruído e um ícone por item obriga a inventar um símbolo para "Consumer
 * Credentials (records)". Um símbolo por seção dá o mapa mental sem o ruído.
 */
export function CmsNavLinks({ groups }: { groups: readonly CmsNavGroup[] }) {
  const pathname = usePathname()

  return (
    <>
      {groups.map((group) => {
        const Icon = NAV_ICONS[group.icon]
        return (
          <section className="cms-nav-group" key={group.label} aria-labelledby={`cms-nav-${group.label}`}>
            <h2 id={`cms-nav-${group.label}`}>
              {Icon && (
                <span className="cms-nav-group__icon">
                  <Icon />
                </span>
              )}
              {group.label}
            </h2>
            {group.items.map((item) => {
              const active = isNavItemActive(item, pathname)
              const label = (
                <>
                  {active && <div className="nav__link-indicator" />}
                  <span className="nav__link-label">{item.label}</span>
                </>
              )

              // Igual ao DefaultNav: a página atual não vira link para si mesma.
              return active ? (
                <div aria-current="page" className="nav__link" key={item.href}>
                  {label}
                </div>
              ) : (
                <Link className="nav__link" href={item.href} key={item.href} prefetch={false}>
                  {label}
                </Link>
              )
            })}
          </section>
        )
      })}
    </>
  )
}
