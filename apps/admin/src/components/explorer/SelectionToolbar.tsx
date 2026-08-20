'use client'

import type { SelectionState } from '../../explorer/types'

export function SelectionToolbar({ onSelectAllMatching, onApplyToCollections, selection, total, applying }: {
  onSelectAllMatching: () => void
  onApplyToCollections: () => void
  selection: SelectionState
  total: number | null
  applying: boolean
}) {
  const message = selection.mode === 'all_matching'
    ? `${selection.previewCount?.toLocaleString() ?? 'All'} matching Curations selected`
    : `${selection.selected.size.toLocaleString()} Curations selected`
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
