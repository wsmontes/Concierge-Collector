import type { ReactNode } from 'react'

/**
 * Estado vazio: diz o que falta e oferece a saída. Um "nenhum resultado" sem
 * ação é um beco sem saída — a lista que filtra demais precisa do caminho de
 * volta (limpar filtros) no mesmo bloco.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <section className="ui-empty" aria-label={title}>
      <div>
        <h2 className="ui-empty__title">{title}</h2>
        {description && <p className="ui-empty__description">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </section>
  )
}
