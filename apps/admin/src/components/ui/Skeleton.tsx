/**
 * Esqueleto de carregamento. Substitui o "Loading Curations…" de texto: o texto
 * não diz quantas linhas vêm, o esqueleto diz — e mantém a altura da tabela, de
 * modo que a lista não "salta" quando o dado chega.
 */
export function Skeleton({
  variant = 'line',
  width,
}: {
  variant?: 'line' | 'row' | 'thumb'
  width?: string
}) {
  const variantClass = variant === 'line' ? '' : `ui-skeleton--${variant}`
  return (
    <span
      aria-hidden="true"
      className={`ui-skeleton ${variantClass}`.trim()}
      style={width ? ({ '--ui-skeleton-width': width } as React.CSSProperties) : undefined}
    />
  )
}

/** Pilha de esqueletos com a altura de uma linha de tabela. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="ui-skeleton-stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="ui-skeleton ui-skeleton--row" style={{ width: `${100 - (index % 3) * 8}%` }} />
      ))}
    </div>
  )
}
