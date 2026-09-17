'use client'

import type { DefaultCellComponentProps } from 'payload'
import { Chip } from '../../ui/Chip'

/**
 * Célula de booleano: um chip `Yes`/`No`, nunca `true`/`false` em texto cru.
 *
 * A lista nativa desenhava o booleano como `<code>false</code>` — o mesmo peso
 * visual de um identificador, e com a palavra em inglês minúsculo no meio de uma
 * coluna de rótulos. O chip ainda dá o tom: `success` quando ligado, `muted`
 * quando desligado, de modo que a coluna inteira vira varredura visual.
 *
 * Os rótulos são configuráveis por `clientProps` para o caso em que "Yes" é
 * ambíguo fora do header da coluna.
 */
export function BooleanCell({ cellData, customCellProps }: DefaultCellComponentProps) {
  const labels = (customCellProps as { trueLabel?: string; falseLabel?: string } | undefined) ?? {}
  const enabled = cellData === true

  return (
    <Chip size="sm" tone={enabled ? 'success' : 'muted'}>
      {enabled ? (labels.trueLabel ?? 'Yes') : (labels.falseLabel ?? 'No')}
    </Chip>
  )
}
