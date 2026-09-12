'use client'

import type { SelectionState } from '../../explorer/types'

/**
 * "1 Curation" / "0 Curations" — o rótulo era plural fixo, então uma seleção
 * de um único item anunciava "1 Curations selected" (a leitura em voz alta
 * errava o singular). O padrão já estava especificado nos testes de unidade
 * do Explorer; a implementação é que tinha divergido.
 */
function curationCountLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'Curation' : 'Curations'}`
}

export function SelectionToolbar({ onSelectAllMatching, onApplyToCollections, selection, total, applying }: {
  onSelectAllMatching: () => void
  onApplyToCollections: () => void
  selection: SelectionState
  total: number | null
  applying: boolean
}) {
  const message = selection.mode === 'all_matching'
    // Wording do modo all-matching mantido: "<n> matching Curations selected"
    // (com "All" quando o preview ainda não chegou). Só o ramo de seleção
    // explícita precisava de singular/plural.
    ? `${selection.previewCount?.toLocaleString() ?? 'All'} matching Curations selected`
    : `${curationCountLabel(selection.selected.size)} selected`
  const hasSelection = selection.mode === 'all_matching' || selection.selected.size > 0
  return (
    <div className="selection-toolbar">
      <p aria-live="polite" role="status">{message}</p>
      {selection.mode === 'explicit' && (
        <button onClick={onSelectAllMatching} type="button">Select all matching results</button>
      )}
      {hasSelection && (
        <button className="selection-toolbar__apply" disabled={applying} onClick={onApplyToCollections} type="button">
          {applying ? 'Materializing selection…' : 'Apply to Collections…'}
        </button>
      )}
      <p className="selection-toolbar__hint">
        {total === null ? 'Selection is kept as a server-side intent.' : `${total.toLocaleString()} results match these filters.`}
      </p>
    </div>
  )
}
