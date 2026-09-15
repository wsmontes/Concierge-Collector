'use client'

import { Button } from '@payloadcms/ui'
import type { FormEvent } from 'react'
import { descriptorsFor } from '../../content/field-registry'

/** Filter values as typed, before they are applied to the list and the URL. */
export interface EntityFilterDraft {
  q: string
  type: string
  status: string
}

/**
 * The vocabulary of a registry enum field. The filter offers exactly what the
 * field registry declares — never a second, drifting copy of the enum.
 */
function enumOptions(path: string): readonly string[] {
  const descriptor = descriptorsFor('entity').find((entry) => entry.path === path)
  return descriptor?.enumValues ?? []
}

export function EntitiesFilterForm({
  value,
  onChange,
  onApply,
  onReset,
}: {
  value: EntityFilterDraft
  onChange: (value: EntityFilterDraft) => void
  onApply: () => void
  onReset: () => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onApply()
  }

  return <form aria-label="Entity filters" className="entities-filter-form" onSubmit={submit}>
    <header className="entities-filter-form__header">
      <h2>Filters</h2>
      <p>Narrow the Entities without changing the stored records.</p>
    </header>
    <div className="entities-filter-form__fields">
      <label>
        Search Entities
        <input onChange={(event) => onChange({ ...value, q: event.target.value })} type="search" value={value.q} />
      </label>
      <label>
        Type
        <select onChange={(event) => onChange({ ...value, type: event.target.value })} value={value.type}>
          <option value="">All types</option>
          {enumOptions('type').map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        Status
        <select onChange={(event) => onChange({ ...value, status: event.target.value })} value={value.status}>
          <option value="">All statuses</option>
          {enumOptions('status').map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    </div>
    <div className="entities-filter-form__actions">
      <Button margin={false} type="submit">Apply filters</Button>
      <Button buttonStyle="secondary" margin={false} onClick={onReset} type="button">Reset filters</Button>
    </div>
  </form>
}
