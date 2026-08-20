'use client'

import type { SelectionState } from '../../explorer/types'

export function SelectionToolbar({ onSelectAllMatching, selection, total }: {
  onSelectAllMatching: () => void
  selection: SelectionState
  total: number | null
}) {
  const message = selection.mode === 'all_matching'
    ? `${selection.previewCount?.toLocaleString() ?? 'All'} matching Curations selected`
    : `${selection.selected.size.toLocaleString()} Curations selected`
  return (
    <div className="selection-toolbar">
      <p aria-live="polite" role="status">{message}</p>
      {selection.mode === 'explicit' && (
        <button onClick={onSelectAllMatching} type="button">Select all matching results</button>
      )}
      <p className="selection-toolbar__hint">
        {total === null ? 'Selection is kept as a server-side intent.' : `${total.toLocaleString()} results match these filters.`}
      </p>
    </div>
  )
}
