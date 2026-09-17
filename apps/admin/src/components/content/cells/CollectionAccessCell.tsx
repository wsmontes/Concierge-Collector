'use client'

import type { DefaultCellComponentProps } from 'payload'
import { Chip } from '../../ui/Chip'

/**
 * Acesso a Collections de uma application do consumidor.
 *
 * `allowedCollectionIds` é um array de um nível: na lista nativa ele saía como o
 * JSON do array inteiro, com os ObjectIds, e ocupava a coluna toda. O que a
 * lista precisa responder é "esta application enxerga alguma coisa, e quanto?" —
 * então a célula conta os vínculos e deixa o detalhe (quem são) para a tela de
 * detalhe, que tem espaço para nomear collection por collection.
 */
export function CollectionAccessCell({ cellData }: DefaultCellComponentProps) {
  const granted = Array.isArray(cellData) ? cellData.length : 0

  if (granted === 0) return <span className="ui-table__secondary">No Collection access</span>

  return (
    <Chip size="sm" tone="accent">
      {granted === 1 ? '1 Collection' : `${granted} Collections`}
    </Chip>
  )
}
