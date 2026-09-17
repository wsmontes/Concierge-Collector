import type { ReactNode } from 'react'

/**
 * Superfícies do kit. `Card` é o bloco de conteúdo com moldura; `KpiCard` é o
 * contador clicável do painel (número grande, rótulo pequeno, dica opcional);
 * `Facts` é a lista de par chave/valor usada no rail de detalhe.
 */
export function Card({
  title,
  description,
  actions,
  children,
  tone = 'default',
  className = '',
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  tone?: 'default' | 'plain' | 'quiet' | 'flush'
  className?: string
}) {
  const toneClass = tone === 'default' ? '' : `ui-card--${tone}`
  return (
    <section className={`ui-card ${toneClass} ${className}`.trim()}>
      {(title || actions) && (
        <header className="ui-section__header">
          <div>
            {title && <h2 className="ui-card__title">{title}</h2>}
            {description && <p className="ui-card__description">{description}</p>}
          </div>
          {actions && <div className="ui-section__action">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

/**
 * Contador do painel. Quando recebe `href` vira link — o contador do painel não
 * é enfeite, é a entrada da lista já filtrada.
 *
 * O número vem ANTES do rótulo, no DOM e na tela: é ele que o operador procura,
 * e é ele que dá o nome acessível do link ("18,430 Curations").
 */
export function KpiCard({
  label,
  value,
  hint,
  href,
  title,
}: {
  label: string
  value: ReactNode
  hint?: string
  href?: string
  title?: string
}) {
  const body = (
    <>
      <span className="ui-kpi__value">{value}</span>
      <span className="ui-kpi__label">{label}</span>
      {hint && <span className="ui-kpi__hint">{hint}</span>}
    </>
  )
  if (!href) return <div className="ui-card ui-kpi">{body}</div>
  return (
    <a className="ui-card ui-kpi" href={href} title={title}>
      {body}
    </a>
  )
}

export function FactList({
  facts,
  className = '',
}: {
  facts: Array<{ label: string; value: ReactNode }>
  className?: string
}) {
  return (
    <dl className={`ui-facts ${className}`.trim()}>
      {facts.map((fact) => (
        <div key={fact.label} style={{ display: 'contents' }}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}
