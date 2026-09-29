import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ExplorerFilterForm } from '../../../src/components/explorer/ExplorerFilterForm'

afterEach(() => cleanup())

test('edits search, dimensions and selectable statuses without applying on each keystroke', () => {
  const onChange = vi.fn()
  const onApply = vi.fn()
  render(<ExplorerFilterForm value={{ q: 'sushi', status: ['active'] }} onChange={onChange} onApply={onApply} onClear={vi.fn()} />)

  fireEvent.change(screen.getByLabelText('Search Curations'), { target: { value: ' ramen ' } })
  expect(onChange).toHaveBeenCalledWith({ q: ' ramen ', status: ['active'] })
  expect(onApply).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('checkbox', { name: 'Draft' }))
  expect(onChange).toHaveBeenCalledWith({ q: 'sushi', status: ['active', 'draft'] })

  fireEvent.submit(screen.getByRole('form', { name: 'Curation filters' }))
  expect(onApply).toHaveBeenCalledTimes(1)
})

test('Clear delegates a complete filter reset', () => {
  const onClear = vi.fn()
  render(<ExplorerFilterForm value={{ city: 'Victoria', entity_type: 'restaurant' }} onChange={vi.fn()} onApply={vi.fn()} onClear={onClear} />)
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(onClear).toHaveBeenCalledTimes(1)
})
