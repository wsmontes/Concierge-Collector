'use client'

import { Button } from '@payloadcms/ui'
import type { FormEvent } from 'react'
import {
  operatorLabel,
  type CurationConceptFilter,
  type CurationFilters,
  type WhereClause,
} from '../../explorer/types'
import { AdvancedFilterBuilder } from './AdvancedFilterBuilder'

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

/** How an applied condition reads on its chip, e.g. `notes.private contains anniversary`. */
function clauseText(clause: WhereClause): string {
  const label = `${clause.field} ${operatorLabel(clause.op)}`
  const value = Array.isArray(clause.value) ? clause.value.join(', ') : clause.value
  return value === undefined || value === null || value === '' ? label : `${label} ${String(value)}`
}

/**
 * The filter draft. It is deliberately not the applied state: typing narrows
 * nothing until Apply, so a slow list request never races the operator.
 */
export function CurationsFilterForm({
  value,
  concepts = [],
  where = [],
  onChange,
  onApply,
  onClear,
  onRemoveConcept,
  onRemoveWhere,
}: {
  value: CurationFilters
  concepts?: readonly CurationConceptFilter[]
  where?: readonly WhereClause[]
  onChange: (value: CurationFilters) => void
  onApply: () => void
  onClear: () => void
  onRemoveConcept?: (concept: CurationConceptFilter) => void
  onRemoveWhere?: (clause: WhereClause) => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onApply()
  }

  return <form aria-label="Curation filters" className="curations-filter-form" onSubmit={submit}>
    <header className="curations-filter-form__header">
      <div>
        <h2>Filters</h2>
        <p>Narrow the catalog without changing the underlying Curations.</p>
      </div>
    </header>
    <div className="curations-filter-form__fields">
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
    <fieldset className="curations-filter-form__statuses">
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
    <AdvancedFilterBuilder value={value.where ?? []} onChange={(clauses) => onChange({ ...value, where: clauses })} />
    {(concepts.length > 0 || where.length > 0) && (
      <div aria-label="Applied filters" className="curations-filter-form__concepts" role="group">
        {concepts.map((concept) => (
          <span className="curations-filter-form__concept" key={`${concept.category}:${concept.value}`}>
            {`${concept.category}: ${concept.value}`}
            <button
              aria-label={`Remove ${concept.category}: ${concept.value}`}
              onClick={() => onRemoveConcept?.(concept)}
              type="button"
            >
              ×
            </button>
          </span>
        ))}
        {where.map((clause, index) => (
          <span className="curations-filter-form__condition" key={`${clause.field}:${clause.op}:${index}`}>
            {clauseText(clause)}
            <button
              aria-label={`Remove condition ${clauseText(clause)}`}
              onClick={() => onRemoveWhere?.(clause)}
              type="button"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    )}
    <div className="curations-filter-form__actions">
      <Button margin={false} type="submit">Apply filters</Button>
      <Button buttonStyle="secondary" margin={false} type="button" onClick={onClear}>Clear filters</Button>
    </div>
  </form>
}
