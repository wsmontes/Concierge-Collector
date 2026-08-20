import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { VirtualCurationTable } from '../../../src/components/explorer/VirtualCurationTable'
import { makeRows } from '../../support/factories'

describe('VirtualCurationTable', () => {
  afterEach(cleanup)

  test('keeps the DOM bounded for a 50k-row result', () => {
    render(<VirtualCurationTable height={600} rowHeight={44} rows={makeRows(50_000)} />)

    expect(screen.getAllByRole('row').length).toBeLessThan(100)
    expect(screen.getByText('Restaurant 1')).toBeTruthy()
  })
})
