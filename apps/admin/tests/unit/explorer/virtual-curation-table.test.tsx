import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { VirtualCurationTable } from '../../../src/components/explorer/VirtualCurationTable'
import type { AdminCurationRow } from '../../../src/explorer/types'
import { makeRows } from '../../support/factories'

describe('VirtualCurationTable', () => {
  afterEach(cleanup)

  test('keeps the DOM bounded for a 50k-row result', () => {
    render(<VirtualCurationTable height={600} rowHeight={44} rows={makeRows(50_000)} />)

    expect(screen.getAllByRole('row').length).toBeLessThan(100)
    expect(screen.getByText('Restaurant 1')).toBeTruthy()
  })

  test('header checkbox is indeterminate when only some loaded rows are selected', () => {
    const rows = makeRows(3)
    const isSelected = (row: AdminCurationRow) => row.curation_id === rows[0].curation_id
    render(<VirtualCurationTable height={600} rowHeight={44} rows={rows} isSelected={isSelected} />)

    const header = screen.getByLabelText('Select all loaded Curations') as HTMLInputElement
    expect(header.indeterminate).toBe(true)
    expect(header.checked).toBe(false)
  })

  test('header checkbox is checked when every loaded row is selected and forwards the toggle', () => {
    const onToggleAllLoaded = vi.fn()
    render(<VirtualCurationTable
      height={600}
      isSelected={() => true}
      onToggleAllLoaded={onToggleAllLoaded}
      rowHeight={44}
      rows={makeRows(2)}
    />)

    const header = screen.getByLabelText('Select all loaded Curations') as HTMLInputElement
    expect(header.indeterminate).toBe(false)
    expect(header.checked).toBe(true)

    fireEvent.click(header)
    expect(onToggleAllLoaded).toHaveBeenCalledWith(false)
  })

  test('arrow keys move the active row and space toggles it', () => {
    const onToggle = vi.fn()
    const { container } = render(<VirtualCurationTable height={600} onToggle={onToggle} rowHeight={44} rows={makeRows(3)} />)
    const table = screen.getByRole('table')

    fireEvent.keyDown(table, { key: 'ArrowDown' })
    fireEvent.keyDown(table, { key: 'ArrowDown' })
    expect(container.querySelector('[data-active="true"]')?.getAttribute('data-index')).toBe('1')

    fireEvent.keyDown(table, { key: ' ' })
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ curation_id: 'curation-2' }), 1, false)

    fireEvent.keyDown(table, { key: 'ArrowUp' })
    expect(container.querySelector('[data-active="true"]')?.getAttribute('data-index')).toBe('0')

    // The range is clamped to the loaded rows.
    fireEvent.keyDown(table, { key: 'ArrowUp' })
    expect(container.querySelector('[data-active="true"]')?.getAttribute('data-index')).toBe('0')
  })

  test('space while a nested checkbox is focused does not double-toggle', () => {
    const onToggle = vi.fn()
    render(<VirtualCurationTable height={600} onToggle={onToggle} rowHeight={44} rows={makeRows(1)} />)
    const rowCheckbox = screen.getByLabelText('Select Restaurant 1')

    fireEvent.keyDown(rowCheckbox, { key: ' ' })
    expect(onToggle).not.toHaveBeenCalled()
  })
})
