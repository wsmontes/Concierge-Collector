import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AdvancedFilterBuilder } from '../../../src/components/curations/AdvancedFilterBuilder'
import { WHERE_OPERATORS, type WhereClause } from '../../../src/explorer/types'

afterEach(cleanup)

function operatorValues(index = 1): string[] {
  const select = screen.getByLabelText(`Filter ${index} operator`) as HTMLSelectElement
  return [...select.querySelectorAll('option')].map((option) => option.value)
}

function renderRow(clause: WhereClause, onChange = vi.fn()) {
  render(<AdvancedFilterBuilder onChange={onChange} value={[clause]} />)
  return onChange
}

describe('AdvancedFilterBuilder operators', () => {
  test('offers the registry operator set of an enum field', () => {
    renderRow({ field: 'curator_type', op: 'equals', value: 'synthetic' })

    expect(operatorValues()).toEqual(['equals', 'not_equals', 'is_empty', 'is_not_empty'])
  })

  test('offers before/after for a dateTime field', () => {
    renderRow({ field: 'updatedAt', op: 'after', value: '2026-01-01' })

    expect(operatorValues()).toEqual(['before', 'after'])
    expect(screen.getByLabelText('Filter 1 value')).toHaveAttribute('type', 'date')
  })

  test('offers the numeric comparisons for a number field', () => {
    renderRow({ field: 'catalog_sequence', op: 'greater_than', value: 4 })

    expect(operatorValues()).toEqual(['greater_than', 'less_than', 'equals'])
    expect(screen.getByLabelText('Filter 1 value')).toHaveAttribute('type', 'number')
  })

  test('offers the text operators for a text field', () => {
    renderRow({ field: 'notes.private', op: 'contains', value: 'anniversary' })

    expect(operatorValues()).toEqual([
      'equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'exists', 'not_exists', 'is_empty', 'is_not_empty',
    ])
    expect(screen.getByLabelText('Filter 1 value')).toHaveAttribute('type', 'text')
  })

  test('falls back to the whole vocabulary for a path the registry cannot type', () => {
    renderRow({ field: 'metadata.google_places.rating', op: 'greater_than', value: 4 })

    expect(operatorValues()).toEqual(WHERE_OPERATORS.map((operator) => operator.id))
  })

  test('selects an enum value from the registry vocabulary', () => {
    const onChange = renderRow({ field: 'curator_type', op: 'equals', value: 'synthetic' })
    const select = screen.getByLabelText('Filter 1 value') as HTMLSelectElement

    expect([...select.querySelectorAll('option')].map((option) => option.value)).toEqual(['', 'human', 'synthetic'])
    fireEvent.change(select, { target: { value: 'human' } })
    expect(onChange).toHaveBeenCalledWith([{ field: 'curator_type', op: 'equals', value: 'human' }])
  })
})

describe('AdvancedFilterBuilder value control', () => {
  test('hides the value input for an operator that takes none', () => {
    renderRow({ field: 'sources.audio', op: 'exists' })

    expect(screen.queryByLabelText('Filter 1 value')).toBeNull()
    expect(screen.getByText('No value')).toBeVisible()
  })

  test('drops a draft value when the operator stops taking one', () => {
    const onChange = renderRow({ field: 'transcript', op: 'contains', value: 'stale draft' })

    fireEvent.change(screen.getByLabelText('Filter 1 operator'), { target: { value: 'is_empty' } })
    expect(onChange).toHaveBeenCalledWith([{ field: 'transcript', op: 'is_empty' }])
  })

  test('keeps the draft value while the operator keeps its shape', () => {
    const onChange = renderRow({ field: 'notes.private', op: 'contains', value: 'anniversary' })

    fireEvent.change(screen.getByLabelText('Filter 1 operator'), { target: { value: 'starts_with' } })
    expect(onChange).toHaveBeenCalledWith([{ field: 'notes.private', op: 'starts_with', value: 'anniversary' }])
  })

  test('renders contains_any as a comma-separated list of strings', () => {
    const onChange = renderRow({ field: 'categories.Mood', op: 'contains_any', value: ['Casual'] })

    expect(operatorValues()).toEqual(['contains_any', 'contains_all', 'is_empty', 'is_not_empty'])
    const input = screen.getByLabelText('Filter 1 value')
    expect(input).toHaveValue('Casual')

    fireEvent.change(input, { target: { value: 'Casual, Business, ' } })
    expect(onChange).toHaveBeenCalledWith([{ field: 'categories.Mood', op: 'contains_any', value: ['Casual', 'Business'] }])
  })

  test('types a number as a number', () => {
    const onChange = renderRow({ field: 'catalog_sequence', op: 'greater_than', value: 4 })

    fireEvent.change(screen.getByLabelText('Filter 1 value'), { target: { value: '12' } })
    expect(onChange).toHaveBeenCalledWith([{ field: 'catalog_sequence', op: 'greater_than', value: 12 }])
  })
})

describe('AdvancedFilterBuilder rows', () => {
  test('adds an empty row and removes exactly the row it names', () => {
    const onChange = vi.fn()
    render(<AdvancedFilterBuilder
      onChange={onChange}
      value={[{ field: 'city', op: 'equals', value: 'Victoria' }, { field: 'sources.audio', op: 'exists' }]}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    expect(onChange).toHaveBeenCalledWith([
      { field: 'city', op: 'equals', value: 'Victoria' },
      { field: 'sources.audio', op: 'exists' },
      { field: '', op: 'equals' },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Remove filter 1' }))
    expect(onChange).toHaveBeenLastCalledWith([{ field: 'sources.audio', op: 'exists' }])
  })

  test('suggests the filterable registry paths and the open-ended templates', () => {
    renderRow({ field: 'city', op: 'equals', value: 'Victoria' })

    const listId = screen.getByLabelText('Filter 1 field').getAttribute('list') ?? ''
    const suggestions = [...(document.getElementById(listId)?.querySelectorAll('option') ?? [])]
      .map((option) => option.value)

    expect(suggestions).toContain('notes.private')
    expect(suggestions).toContain('curator_type')
    expect(suggestions).toContain('updatedAt')
    expect(suggestions).toContain('categories.<Category>')
    expect(suggestions).toContain('sources.<key>')
    // A path the server does not evaluate is not offered as a filter.
    expect(suggestions).not.toContain('curator.email')
  })
})
