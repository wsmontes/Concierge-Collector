'use client'

import { CURATION_SORTS, type CurationSort } from '../../content/record-types'
import { isCurationSort } from '../../explorer/types'
import { SelectInput } from '../ui/Field'

/** Sort selector for the list. Options come from the frozen sort vocabulary. */
export function CurationSortPicker({
  value,
  onChange,
}: {
  value: CurationSort
  onChange: (sort: CurationSort) => void
}) {
  return <div className="curation-sort-picker">
    <SelectInput
      id="curation-sort"
      label="Sort"
      onChange={(sort) => {
        if (isCurationSort(sort)) onChange(sort)
      }}
      options={CURATION_SORTS.map((sort) => ({ label: sort.label, value: sort.id }))}
      value={value}
    />
  </div>
}
