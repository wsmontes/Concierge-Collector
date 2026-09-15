import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CurationColumnPicker } from '../../../src/components/curations/CurationColumnPicker'
import { CurationSortPicker } from '../../../src/components/curations/CurationSortPicker'
import { CURATION_SORTS } from '../../../src/content/record-types'

afterEach(cleanup)

describe('CurationColumnPicker', () => {
  test('writes the canonical column set and keeps the fixed column out of reach', () => {
    const onChange = vi.fn()
    render(<CurationColumnPicker onChange={onChange} value={['curation', 'city']} />)

    expect(screen.getByLabelText('Curation')).toBeDisabled()
    expect(screen.getByLabelText('Curation')).toBeChecked()
    expect(screen.getByLabelText('City')).toBeChecked()

    fireEvent.click(screen.getByLabelText('Created'))
    expect(onChange).toHaveBeenCalledWith(['curation', 'city', 'created'])

    fireEvent.click(screen.getByLabelText('City'))
    expect(onChange).toHaveBeenLastCalledWith(['curation'])
  })
})

describe('CurationSortPicker', () => {
  test('offers every supported sort and reports the selection', () => {
    const onChange = vi.fn()
    render(<CurationSortPicker onChange={onChange} value="updated_at_desc" />)

    const select = screen.getByLabelText('Sort')
    expect(select).toHaveValue('updated_at_desc')
    // The picker lists the frozen vocabulary exactly — no pinned labels.
    expect([...select.querySelectorAll('option')].map((option) => option.value))
      .toEqual(CURATION_SORTS.map((sort) => sort.id))

    const chosen = CURATION_SORTS[CURATION_SORTS.length - 1]
    fireEvent.change(select, { target: { value: chosen.id } })
    expect(onChange).toHaveBeenCalledWith(chosen.id)
  })
})
