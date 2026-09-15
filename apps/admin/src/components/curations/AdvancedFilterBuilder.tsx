'use client'

import { Button } from '@payloadcms/ui'
import { useId } from 'react'
import { descriptorsFor } from '../../content/field-registry'
import type { FieldDescriptor, FieldType } from '../../content/field-types'
import {
  isValuelessWhereOperator,
  isWhereOperator,
  operatorLabel,
  WHERE_OPERATORS,
  type WhereClause,
  type WhereOperator,
} from '../../explorer/types'

/**
 * Operator sets per registry field type (plan §8). A type the registry cannot
 * describe still gets the full vocabulary: the point of the advanced search is
 * that an unlabelled field stays searchable.
 */
const TEXT_OPERATORS: readonly WhereOperator[] = [
  'equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'exists', 'not_exists', 'is_empty', 'is_not_empty',
]

const FULL_OPERATORS: readonly WhereOperator[] = WHERE_OPERATORS.map((operator) => operator.id)

const OPERATORS_BY_TYPE: Record<FieldType, readonly WhereOperator[]> = {
  text: TEXT_OPERATORS,
  longText: TEXT_OPERATORS,
  number: ['greater_than', 'less_than', 'equals'],
  boolean: ['equals', 'not_equals', 'exists', 'not_exists'],
  dateTime: ['before', 'after'],
  enum: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  relationship: ['equals', 'not_equals', 'exists', 'not_exists', 'is_empty', 'is_not_empty'],
  concept: ['contains_any', 'contains_all', 'is_empty', 'is_not_empty'],
  array: ['contains_any', 'contains_all', 'contains', 'not_contains', 'is_empty', 'is_not_empty'],
  object: ['exists', 'not_exists', 'is_empty', 'is_not_empty'],
  json: ['exists', 'not_exists', 'is_empty', 'is_not_empty'],
  binary: ['exists', 'not_exists', 'is_empty', 'is_not_empty'],
  unknown: FULL_OPERATORS,
}

/** Open-ended paths the registry cannot enumerate are offered as examples. */
const PATH_TEMPLATES = ['categories.<Category>', 'sources.<key>'] as const

const CURATION_FIELDS = descriptorsFor('curation')

/**
 * The registry entry that types a path. A dotted path the registry only knows
 * by its root (`categories.Mood`, `sources.audio`) borrows the root's type.
 */
function descriptorFor(path: string): FieldDescriptor | null {
  const exact = CURATION_FIELDS.find((entry) => entry.path === path)
  if (exact) return exact
  const root = path.split('.')[0]
  return CURATION_FIELDS.find((entry) => entry.path === root) ?? null
}

function operatorsFor(path: string): readonly WhereOperator[] {
  return OPERATORS_BY_TYPE[descriptorFor(path)?.type ?? 'unknown']
}

type ValueKind = 'number' | 'date' | 'enum' | 'list' | 'text'

/**
 * The control a clause needs: it follows the operator first, then the type.
 * `null` means the operator carries no value at all.
 */
function valueKindFor(op: WhereOperator, type: FieldType | null): ValueKind | null {
  if (isValuelessWhereOperator(op)) return null
  if (op === 'contains_any' || op === 'contains_all') return 'list'
  if (type === 'number' && (op === 'equals' || op === 'not_equals' || op === 'greater_than' || op === 'less_than')) {
    return 'number'
  }
  if (type === 'dateTime' && (op === 'before' || op === 'after')) return 'date'
  if (type === 'enum' && (op === 'equals' || op === 'not_equals')) return 'enum'
  return 'text'
}

/** Keeps a draft value only while the new operator speaks the same shape. */
function withOperator(clause: WhereClause, op: WhereOperator): WhereClause {
  const type = descriptorFor(clause.field)?.type ?? null
  const kind = valueKindFor(op, type)
  const keep = kind !== null && kind === valueKindFor(clause.op, type)
  return keep && clause.value !== undefined ? { field: clause.field, op, value: clause.value } : { field: clause.field, op }
}

function withField(clause: WhereClause, field: string): WhereClause {
  const operators = operatorsFor(field)
  const op = operators.includes(clause.op) ? clause.op : operators[0]
  return op === clause.op && clause.value !== undefined ? { field, op, value: clause.value } : { field, op }
}

/**
 * Advanced field search (plan §8): one row per `<field> <op> <value>` clause,
 * with the field list and the operator list coming from the content registry.
 * The rows are the *draft* — nothing narrows until the form is applied.
 */
export function AdvancedFilterBuilder({
  value = [],
  onChange,
}: {
  value?: readonly WhereClause[]
  onChange: (clauses: WhereClause[]) => void
}) {
  const listId = useId()

  function replace(index: number, clause: WhereClause) {
    onChange(value.map((entry, at) => (at === index ? clause : entry)))
  }

  return <div className="curation-filter-builder">
    <h3 className="curation-filter-builder__title">Advanced field search</h3>
    <p className="curation-filter-builder__help">
      Search any known field with the operator that fits it. Conditions combine with AND.
    </p>
    <datalist id={listId}>
      {CURATION_FIELDS.filter((field) => field.filterable === true).map((field) =>
        <option key={field.path} value={field.path}>{field.label}</option>)}
      {PATH_TEMPLATES.map((template) => <option key={template} value={template} />)}
    </datalist>
    {value.map((clause, index) => {
      const descriptor = descriptorFor(clause.field)
      const kind = valueKindFor(clause.op, descriptor?.type ?? null)
      const raw = clause.value === undefined || clause.value === null ? '' : clause.value
      return <div className="curation-filter-builder__row" key={index}>
        <label className="curation-filter-builder__control">
          {`Field ${index + 1}`}
          <input
            aria-label={`Filter ${index + 1} field`}
            list={listId}
            onChange={(event) => replace(index, withField(clause, event.target.value))}
            placeholder="notes.private"
            value={clause.field}
          />
        </label>
        <label className="curation-filter-builder__control">
          {`Operator ${index + 1}`}
          <select
            aria-label={`Filter ${index + 1} operator`}
            onChange={(event) => {
              const op = event.target.value
              if (isWhereOperator(op)) replace(index, withOperator(clause, op))
            }}
            value={clause.op}
          >
            {operatorsFor(clause.field).map((op) => <option key={op} value={op}>{operatorLabel(op)}</option>)}
          </select>
        </label>
        {kind === null ? <span className="curation-filter-builder__novalue">No value</span> : (
          <label className="curation-filter-builder__control">
            {`Value ${index + 1}`}
            {kind === 'enum' ? (
              <select
                aria-label={`Filter ${index + 1} value`}
                onChange={(event) => replace(index, { ...clause, value: event.target.value })}
                value={String(raw)}
              >
                <option value="">Not set</option>
                {(descriptor?.enumValues ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input
                aria-label={`Filter ${index + 1} value`}
                onChange={(event) => replace(index, {
                  ...clause,
                  value: kind === 'number' && event.target.value !== ''
                    ? Number(event.target.value)
                    : kind === 'list'
                      ? event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean)
                      : event.target.value,
                })}
                type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
                value={kind === 'list' ? (Array.isArray(raw) ? raw.join(', ') : '') : String(raw)}
              />
            )}
          </label>
        )}
        <Button
          aria-label={`Remove filter ${index + 1}`}
          buttonStyle="secondary"
          className="curation-filter-builder__remove"
          margin={false}
          onClick={() => onChange(value.filter((_entry, at) => at !== index))}
          type="button"
        >
          Remove
        </Button>
      </div>
    })}
    <Button
      buttonStyle="secondary"
      margin={false}
      onClick={() => onChange([...value, { field: '', op: 'equals' }])}
      type="button"
    >
      Add filter
    </Button>
  </div>
}
