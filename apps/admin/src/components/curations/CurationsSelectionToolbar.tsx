'use client'

import { Button } from '@payloadcms/ui'
import type { SelectionState } from '../../explorer/types'
import { Chip } from '../ui/Chip'

function curationCountLabel(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'Curation' : 'Curations'}`
}

/**
 * A barra de seleção. Ela é a única fonte do estado da seleção para leitor de
 * tela (`role="status"`), e permanece presa no topo enquanto a lista rola: a
 * intenção "all matching" vale para muito mais do que a faixa carregada, então
 * o número do que está selecionado não pode sair de vista.
 */
export function CurationsSelectionToolbar({ onSelectAllMatching, onApplyToCollections, selection, total, applying }: {
  onSelectAllMatching: () => void
  onApplyToCollections: () => void
  selection: SelectionState
  total: number | null
  applying: boolean
}) {
  const message = selection.mode === 'all_matching'
    ? `${selection.previewCount?.toLocaleString('en-US') ?? 'All'} matching Curations selected`
    : `${curationCountLabel(selection.selected.size)} selected`
  const hasSelection = selection.mode === 'all_matching' || selection.selected.size > 0

  return (
    <div className="curations-selection-toolbar">
      <div className="curations-selection-toolbar__summary" aria-live="polite" role="status">
        <Chip size="sm" tone={hasSelection ? 'accent' : 'neutral'}>{message}</Chip>
      </div>
      {selection.mode === 'explicit' && (
        <Button buttonStyle="secondary" margin={false} onClick={onSelectAllMatching} size="small" type="button">
          Select all matching results
        </Button>
      )}
      {hasSelection && (
        <span className="curations-selection-toolbar__apply">
          <Button
            disabled={applying}
            margin={false}
            onClick={onApplyToCollections}
            size="small"
            type="button"
          >
            {applying ? 'Materializing selection…' : 'Apply to Collections…'}
          </Button>
        </span>
      )}
      <p className="curations-selection-toolbar__hint">
        {total === null ? 'Selection is kept as a server-side intent.' : `${total.toLocaleString('en-US')} results match these filters.`}
      </p>
    </div>
  )
}
