'use client'

import type { FormEvent } from 'react'
import type { CurationFilters } from '../../explorer/types'

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'linked', label: 'Linked' },
] as const

function toggleStatus(value: CurationFilters, status: string): CurationFilters {
  const current = value.status ?? []
  return {
    ...value,
    status: current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
  }
}

export function ExplorerFilterForm({
  value,
  onChange,
  onApply,
  onClear,
}: {
  value: CurationFilters
  onChange: (value: CurationFilters) => void
  onApply: () => void
  onClear: () => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onApply()
  }

  return <form aria-label="Curation filters" className="explorer-filter-form" onSubmit={submit}>
    <div className="explorer-filter-form__fields">
      <label>
        Search Curations
        <input value={value.q ?? ''} onChange={(event) => onChange({ ...value, q: event.target.value })} />
      </label>
      <label>
        City
        <input value={value.city ?? ''} onChange={(event) => onChange({ ...value, city: event.target.value })} />
      </label>
      <label>
        Entity type
        <input value={value.entity_type ?? ''} onChange={(event) => onChange({ ...value, entity_type: event.target.value })} />
      </label>
      <label>
        Curator ID
        <input value={value.curator_id ?? ''} onChange={(event) => onChange({ ...value, curator_id: event.target.value })} />
      </label>
    </div>
    <fieldset className="explorer-filter-form__statuses">
      <legend>Status</legend>
      {STATUS_OPTIONS.map((option) => <label key={option.value}>
        <input
          type="checkbox"
          checked={(value.status ?? []).includes(option.value)}
          onChange={() => onChange(toggleStatus(value, option.value))}
        />
        {option.label}
      </label>)}
    </fieldset>
    <div className="explorer-filter-form__actions">
      <button type="submit">Apply filters</button>
      <button type="button" onClick={onClear}>Clear filters</button>
    </div>
  </form>
}
