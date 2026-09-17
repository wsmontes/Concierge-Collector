'use client'

import { Button } from '@payloadcms/ui'
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  operatorLabel,
  type CurationConceptFilter,
  type CurationFilters,
  type NormalizedCurationFilters,
  type WhereClause,
} from '../../explorer/types'
import { Chip } from '../ui/Chip'
import { Dialog } from '../ui/Dialog'
import { SearchInput, Toolbar, ToolbarGroup } from '../ui/Toolbar'
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

/** Um chip de filtro aplicado, com o mesmo botão de remover em todos os casos. */
function RemovableChip({ label, removeLabel, onRemove }: { label: string; removeLabel?: string; onRemove: () => void }) {
  return (
    <Chip size="sm">
      {label}
      <button
        aria-label={removeLabel ?? `Remove ${label}`}
        className="curations-filters__remove"
        onClick={onRemove}
        type="button"
      >
        ×
      </button>
    </Chip>
  )
}

/**
 * A barra de filtros da lista: busca, filtros rápidos em chip e o construtor
 * avançado atrás de um diálogo — a lista começa logo abaixo.
 *
 * O rascunho é deliberadamente diferente do estado aplicado: digitar não
 * estreita nada até `Apply filters`, então uma requisição lenta nunca disputa
 * com o operador. Os chips de filtro *aplicado* agem na hora, porque remover um
 * filtro que já está valendo não é um rascunho.
 */
export function CurationsFilterForm({
  value,
  applied = {},
  concepts = applied.concepts ?? [],
  where = applied.where ?? [],
  onChange,
  onApply,
  onApplyValue,
  onClear,
  onRemoveConcept,
  onRemoveWhere,
  children,
}: {
  value: CurationFilters
  /** O filtro em vigor (a URL): é o que os chips aplicados mostram. */
  applied?: NormalizedCurationFilters
  concepts?: readonly CurationConceptFilter[]
  where?: readonly WhereClause[]
  onChange: (value: CurationFilters) => void
  onApply: () => void
  /** Aplica um conjunto completo de uma vez — remover um filtro em vigor. */
  onApplyValue?: (value: CurationFilters) => void
  onClear: () => void
  onRemoveConcept?: (concept: CurationConceptFilter) => void
  onRemoveWhere?: (clause: WhereClause) => void
  /** Controles que agem sobre a lista (ordenação, colunas, densidade, views). */
  children?: ReactNode
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onApply()
  }

  function removeApplied(patch: CurationFilters) {
    onApplyValue?.(patch)
  }

  const appliedStatuses = applied.status ?? []
  const appliedChips: Array<{ key: string; label: string; onRemove: () => void }> = []
  if (applied.q) appliedChips.push({ key: 'q', label: `Search: ${applied.q}`, onRemove: () => removeApplied({ ...applied, q: null }) })
  appliedStatuses.forEach((status) => appliedChips.push({
    key: `status:${status}`,
    label: `Status: ${status}`,
    onRemove: () => removeApplied({ ...applied, status: appliedStatuses.filter((entry) => entry !== status) }),
  }))
  if (applied.city) appliedChips.push({ key: 'city', label: `City: ${applied.city}`, onRemove: () => removeApplied({ ...applied, city: null }) })
  if (applied.entity_type) {
    appliedChips.push({ key: 'type', label: `Type: ${applied.entity_type}`, onRemove: () => removeApplied({ ...applied, entity_type: null }) })
  }
  if (applied.curator_id) {
    appliedChips.push({ key: 'curator', label: `Curator: ${applied.curator_id}`, onRemove: () => removeApplied({ ...applied, curator_id: null }) })
  }
  if (applied.without_collections) {
    appliedChips.push({ key: 'without_collections', label: 'Without Collections', onRemove: () => removeApplied({ ...applied, without_collections: undefined }) })
  }
  if (applied.unlinked) appliedChips.push({ key: 'unlinked', label: 'Unlinked', onRemove: () => removeApplied({ ...applied, unlinked: undefined }) })

  const hasApplied = appliedChips.length > 0 || concepts.length > 0 || where.length > 0

  return (
    <form aria-label="Curation filters" className="curations-filters" onSubmit={submit}>
      <Toolbar label="Curation list controls">
        <ToolbarGroup>
          <SearchInput
            label="Search Curations"
            name="curations"
            onChange={(q) => onChange({ ...value, q })}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              // A submissão implícita faria o mesmo; aqui ela é explícita para
              // que o mesmo caminho valha no teste e no navegador.
              event.preventDefault()
              onApply()
            }}
            placeholder="Search Curations"
            value={value.q ?? ''}
          />
          <div aria-label="Quick filters" className="curations-filters__chips" role="group">
            {STATUS_OPTIONS.map((option) => (
              <label
                className="curations-filters__chip"
                data-checked={(value.status ?? []).includes(option.value)}
                key={option.value}
              >
                <input
                  checked={(value.status ?? []).includes(option.value)}
                  onChange={() => onChange(toggleStatus(value, option.value))}
                  type="checkbox"
                />
                {option.label}
              </label>
            ))}
            <label className="curations-filters__chip" data-checked={value.without_collections === true}>
              <input
                checked={value.without_collections === true}
                onChange={(event) => onChange({ ...value, without_collections: event.target.checked })}
                type="checkbox"
              />
              Without Collections
            </label>
          </div>
          <Button
            buttonStyle="secondary"
            margin={false}
            onClick={() => setAdvancedOpen(true)}
            size="small"
            type="button"
          >
            Advanced
          </Button>
        </ToolbarGroup>
        <ToolbarGroup end>
          {children}
          <Button margin={false} type="submit">Apply filters</Button>
        </ToolbarGroup>
        <div className="curations-filters__fields">
          <label className="curations-filters__field">
            <span>City</span>
            <input
              onChange={(event) => onChange({ ...value, city: event.target.value })}
              type="text"
              value={value.city ?? ''}
            />
          </label>
          <label className="curations-filters__field">
            <span>Entity type</span>
            <input
              onChange={(event) => onChange({ ...value, entity_type: event.target.value })}
              type="text"
              value={value.entity_type ?? ''}
            />
          </label>
          <label className="curations-filters__field">
            <span>Curator ID</span>
            <input
              onChange={(event) => onChange({ ...value, curator_id: event.target.value })}
              type="text"
              value={value.curator_id ?? ''}
            />
          </label>
        </div>
      </Toolbar>

      {hasApplied && (
        <div aria-label="Applied filters" className="curations-filters__applied" role="group">
          {appliedChips.map((chip) => (
            <RemovableChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
          ))}
          {concepts.map((concept) => (
            <RemovableChip
              key={`${concept.category}:${concept.value}`}
              label={`${concept.category}: ${concept.value}`}
              onRemove={() => onRemoveConcept?.(concept)}
            />
          ))}
          {where.map((clause, index) => (
            <RemovableChip
              key={`${clause.field}:${clause.op}:${index}`}
              label={clauseText(clause)}
              removeLabel={`Remove condition ${clauseText(clause)}`}
              onRemove={() => onRemoveWhere?.(clause)}
            />
          ))}
          <Button buttonStyle="secondary" margin={false} onClick={onClear} size="small" type="button">
            Clear all
          </Button>
        </div>
      )}

      <Dialog
        description="Search any known field with the operator that fits it. Conditions combine with AND."
        footer={(
          <Button
            margin={false}
            onClick={() => {
              onApply()
              setAdvancedOpen(false)
            }}
            type="button"
          >
            Apply
          </Button>
        )}
        onClose={() => setAdvancedOpen(false)}
        open={advancedOpen}
        title="Advanced filters"
        width="46rem"
      >
        <AdvancedFilterBuilder
          onChange={(clauses) => onChange({ ...value, where: clauses })}
          value={value.where ?? []}
        />
      </Dialog>
    </form>
  )
}
