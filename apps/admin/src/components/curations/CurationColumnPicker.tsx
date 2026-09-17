'use client'

import { CURATION_COLUMNS, normalizeCurationColumns, type CurationColumnId } from '../../content/curation-columns'
import { CheckboxInput } from '../ui/Field'

/**
 * Column visibility. Every toggle goes through the canonical normalizer, so the
 * resulting set keeps the canonical order and always includes the fixed
 * Curation column.
 *
 * A escolha vive na URL (e numa view salva) e em nenhum armazenamento do
 * navegador: a lista não tem (nem precisa de) persistência local de colunas.
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
    <summary className="curations-control curation-column-picker__summary">Columns</summary>
    <fieldset className="curation-column-picker__panel">
      <legend className="curation-column-picker__legend">Visible columns</legend>
      <div className="curation-column-picker__grid">
        {CURATION_COLUMNS.map((column) => (
          <CheckboxInput
            checked={value.includes(column.id)}
            description={column.fixed === true ? 'Always visible' : undefined}
            disabled={column.fixed === true}
            id={`curation-column-${column.id}`}
            key={column.id}
            label={column.label}
            onChange={(visible) => toggle(column.id, visible)}
          />
        ))}
      </div>
    </fieldset>
  </details>
}
