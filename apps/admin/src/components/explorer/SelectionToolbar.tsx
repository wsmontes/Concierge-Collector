'use client'

import { Button, Pill } from '@payloadcms/ui'
import type { SelectionState } from '../../explorer/types'

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
    ? `${selection.previewCount?.toLocaleString() ?? 'All'} matching Curations selected`
    : `${curationCountLabel(selection.selected.size)} selected`
  const hasSelection = selection.mode === 'all_matching' || selection.selected.size > 0

  return (
    <div className="selection-toolbar">
      <div className="selection-toolbar__summary" aria-live="polite" role="status">
        <Pill pillStyle={hasSelection ? 'success' : 'light-gray'} rounded size="small">{message}</Pill>
      </div>
      {selection.mode === 'explicit' && (
        <Button buttonStyle="secondary" margin={false} onClick={onSelectAllMatching} size="small" type="button">
          Select all matching results
        </Button>
      )}
      {hasSelection && (
        <span className="selection-toolbar__apply">
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
      <p className="selection-toolbar__hint">
        {total === null ? 'Selection is kept as a server-side intent.' : `${total.toLocaleString()} results match these filters.`}
      </p>
    </div>
  )
}
