'use client'

import type { DefaultCellComponentProps } from 'payload'
import { asDisplayText } from './cell-value'

/**
 * Identificador técnico na lista: `fastapiUserId`, `applicationId`, `prefix` de
 * uma credencial. São valores que se comparam caractere a caractere com um log
 * ou um ticket, então a célula usa a fonte mono (numerais e hex alinhados) e
 * repete o valor inteiro no `title` — o olho lê o começo, o `title` entrega o
 * resto sem depender da largura da coluna.
 *
 * Não truncamos: um id cortado sem `title` é pior que um id longo, porque a
 * lista passa a mostrar um valor que não existe.
 */
export function MonoCell({ cellData }: DefaultCellComponentProps) {
  const value = asDisplayText(cellData)

  if (value === null) return <span className="ui-table__secondary">—</span>

  return (
    <span className="ui-table__mono" title={value}>
      {value}
    </span>
  )
}
