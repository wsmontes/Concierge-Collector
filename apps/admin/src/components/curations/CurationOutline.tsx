'use client'

import { useEffect, useState, type ReactNode } from 'react'

/**
 * `AdminSection` do kit deriva o `id` do próprio título
 * (`admin-section-<título em slug>`), então o outline precisa refazer a mesma
 * conta para apontar para a seção: o kit ainda não aceita um `id` explícito.
 * A conta é uma só, e o teste de comportamento a cobre — cada item do outline
 * tem de resolver para uma seção realmente renderizada.
 */
export function curationSectionAnchor(title: string): string {
  return `admin-section-${title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

/**
 * "On this page": em que ponto do registro o leitor está, e um atalho para
 * cada seção. Só aparece de três seções para cima — com duas, o outline é mais
 * longo que o valor que acrescenta — e o CSS o esconde abaixo de 1200px, onde
 * o rail deixa de existir em coluna própria.
 *
 * O clique é um link de verdade (`#<id>`), então funciona sem JavaScript,
 * aceita middle-click e mantém o endereço compartilhável; o `IntersectionObserver`
 * só acompanha a leitura para marcar o item ativo.
 */
export function CurationOutline({ sections }: { sections: readonly string[] }): ReactNode {
  const [active, setActive] = useState(() => (sections.length === 0 ? '' : curationSectionAnchor(sections[0])))

  useEffect(() => {
    // jsdom e navegadores antigos não têm o observer: sem ele o outline
    // continua útil, apenas sem acompanhar a rolagem.
    if (typeof IntersectionObserver === 'undefined') return
    const targets = sections
      .map((title) => document.getElementById(curationSectionAnchor(title)))
      .filter((element): element is HTMLElement => element !== null)
    if (targets.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // A faixa de leitura é o terço de cima da viewport: a seção ativa é a
        // que a cruza, e entre duas que cruzam vale a mais alta.
        let topmost: IntersectionObserverEntry | null = null
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          if (topmost === null || entry.boundingClientRect.top < topmost.boundingClientRect.top) topmost = entry
        }
        if (topmost !== null) setActive(topmost.target.id)
      },
      { rootMargin: '-20% 0px -70% 0px' },
    )
    for (const target of targets) observer.observe(target)
    return () => observer.disconnect()
  }, [sections])

  if (sections.length < 3) return null

  return (
    <nav className="ui-outline" aria-label="On this page">
      <p className="ui-outline__title">On this page</p>
      <ul className="ui-outline__list">
        {sections.map((title) => {
          const anchor = curationSectionAnchor(title)
          const current = anchor === active
          return (
            <li key={anchor}>
              <a
                aria-current={current ? 'location' : undefined}
                className="ui-outline__link"
                data-active={current}
                href={`#${anchor}`}
                onClick={() => setActive(anchor)}
              >
                {title}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
