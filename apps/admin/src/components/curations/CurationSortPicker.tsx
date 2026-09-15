'use client'

import { CURATION_SORTS, type CurationSort } from '../../content/record-types'
import { isCurationSort } from '../../explorer/types'

/** Sort selector for the list. Options come from the frozen sort vocabulary. */
export function CurationSortPicker({
  value,
  onChange,
}: {
  value: CurationSort
  onChange: (sort: CurationSort) => void
}) {
  return <label className="curation-sort-picker">
    Sort
    <select
      value={value}
      onChange={(event) => {
        if (isCurationSort(event.target.value)) onChange(event.target.value)
      }}
    >
      {CURATION_SORTS.map((sort) => <option key={sort.id} value={sort.id}>{sort.label}</option>)}
    </select>
  </label>
}
