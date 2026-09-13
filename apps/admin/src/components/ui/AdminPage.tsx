import type { ReactNode } from 'react'

export function AdminPage({
  eyebrow,
  title,
  description,
  actions,
  children,
  className = '',
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <main className={`admin-page ${className}`.trim()}>
      <header className="admin-page__header">
        <div className="admin-page__heading">
          {eyebrow && <p className="admin-page__eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {description && <p className="admin-page__description">{description}</p>}
        </div>
        {actions && <div className="admin-page__actions">{actions}</div>}
      </header>
      <div className="admin-page__body">{children}</div>
    </main>
  )
}

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
    <section className={`admin-section ${className}`.trim()} aria-labelledby={headingId}>
      <header className="admin-section__header">
        <div>
          <h2 id={headingId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action && <div className="admin-section__action">{action}</div>}
      </header>
      <div className="admin-section__body">{children}</div>
    </section>
  )
}
