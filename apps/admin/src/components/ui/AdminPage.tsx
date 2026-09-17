import type { ReactNode } from 'react'

/**
 * Página do Admin: cabeçalho com contexto (trilha, eyebrow, título, descrição,
 * ações) e corpo. O contrato com as telas é o mesmo de antes — `AdminPage` com
 * `eyebrow`/`title`/`description`/`actions`/`children` e `AdminSection` com
 * título, descrição e ação — mas o cabeçalho ganhou trilha de navegação e a
 * opção de ficar preso na rolagem, que é o que uma lista longa precisa para não
 * perder o título e as ações de vista.
 */
export function AdminPage({
  eyebrow,
  title,
  description,
  breadcrumb,
  actions,
  children,
  sticky = false,
  width = 'default',
  className = '',
}: {
  eyebrow?: string
  title: string
  description?: string
  breadcrumb?: Array<{ href?: string; label: string }>
  actions?: ReactNode
  children: ReactNode
  /** Mantém o cabeçalho visível durante a rolagem (listas longas). */
  sticky?: boolean
  /** `wide` para telas que vivem de tabela; `readable` para formulários. */
  width?: 'default' | 'wide' | 'readable'
  className?: string
}) {
  const sizeClass = width === 'wide' ? 'ui-page--wide' : width === 'readable' ? 'ui-page--readable' : ''
  return (
    <main className={`ui-page ${sizeClass} ${className}`.trim()}>
      <header className={`ui-page__header ${sticky ? 'ui-page__header--sticky' : ''}`.trim()}>
        <div className="ui-page__heading">
          {breadcrumb && breadcrumb.length > 0 && (
            <nav aria-label="Breadcrumb">
              <ol className="ui-breadcrumb">
                {breadcrumb.map((item) => (
                  <li key={`${item.label}-${item.href ?? ''}`}>
                    {item.href ? <a href={item.href}>{item.label}</a> : item.label}
                  </li>
                ))}
              </ol>
            </nav>
          )}
          {eyebrow && <p className="ui-page__eyebrow">{eyebrow}</p>}
          <h1 className="ui-page__title">{title}</h1>
          {description && <p className="ui-page__description">{description}</p>}
        </div>
        {actions && <div className="ui-page__actions">{actions}</div>}
      </header>
      <div className="ui-page__body">{children}</div>
    </main>
  )
}

/**
 * Seção titulada dentro de uma página. O `id` do título sai do próprio texto,
 * para que `aria-labelledby` exista sem o chamador inventar um id.
 */
export function AdminSection({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  const headingId = `admin-section-${title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section className={`ui-section ${className}`.trim()} aria-labelledby={headingId}>
      <header className="ui-section__header">
        <div>
          <h2 className="ui-section__title" id={headingId}>{title}</h2>
          {description && <p className="ui-section__description">{description}</p>}
        </div>
        {action && <div className="ui-section__action">{action}</div>}
      </header>
      <div className="ui-section__body">{children}</div>
    </section>
  )
}
