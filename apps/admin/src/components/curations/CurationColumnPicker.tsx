'use client'

import { CURATION_COLUMNS, normalizeCurationColumns, type CurationColumnId } from '../../content/curation-columns'

/**
 * Column visibility. Every toggle goes through the canonical normalizer, so the
 * resulting set keeps the canonical order and always includes the fixed
 * Curation column.
 */
export function CurationColumnPicker({
  value,
  onChange,
}: {
  value: readonly CurationColumnId[]
  onChange: (columns: CurationColumnId[]) => void
}) {
  function toggle(id: CurationColumnId, visible: boolean) {
    onChange(normalizeCurationColumns(visible ? [...value, id] : value.filter((column) => column !== id)))
  }

  return <details className="curation-column-picker">
    <summary>Columns</summary>
    <fieldset>
      <legend className="curation-column-picker__legend">Visible columns</legend>
      {CURATION_COLUMNS.map((column) => (
        <label key={column.id}>
          <input
            checked={value.includes(column.id)}
            disabled={column.fixed === true}
            onChange={(event) => toggle(column.id, event.target.checked)}
            type="checkbox"
          />
          {column.label}
        </label>
      ))}
    </fieldset>
  </details>
}
