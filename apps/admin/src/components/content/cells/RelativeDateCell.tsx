'use client'

import type { DefaultCellComponentProps } from 'payload'
import { formatAbsoluteDate, formatRelativeDate } from '../../ui/format-relative-date'
import { asDisplayText } from './cell-value'

/**
 * Célula de data das collections nativas: tempo relativo no corpo, instante
 * absoluto no `title`.
 *
 * A lista nativa mostrava o ISO cru (`2026-09-15T12:00:00.000Z`), que só é
 * legível depois de um cálculo mental; e uma data vazia aparecia como célula em
 * branco, indistinguível de "não carregou". Aqui o corpo é relativo
 * ("3 days ago") e o `title` mantém o dado exato para quem precisa dele, com o
 * `<time datetime>` preservando a semântica para leitor de tela.
 *
 * O rótulo de vazio é `Never` porque é o que uma data ausente significa nas
 * colunas que usam esta célula (`lastIntrospectedAt`, `lastUsedAt`); um campo
 * cujo vazio signifique outra coisa passa `clientProps.emptyLabel` (por exemplo
 * `No expiry`) em vez de ganhar uma célula própria.
 */
export function RelativeDateCell({ cellData, customCellProps }: DefaultCellComponentProps) {
  const emptyLabel = (customCellProps as { emptyLabel?: string } | undefined)?.emptyLabel ?? 'Never'
  const value = asDisplayText(cellData)

  if (value === null) return <span className="ui-table__secondary">{emptyLabel}</span>

  const absolute = formatAbsoluteDate(value)
  return (
    <time dateTime={value} title={absolute ?? undefined}>
      {formatRelativeDate(value)}
    </time>
  )
}
