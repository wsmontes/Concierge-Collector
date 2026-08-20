import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { CurationExplorer } from '../../../src/components/explorer/CurationExplorer'
import { makeRows } from '../../support/factories'

describe('CurationExplorer selection', () => {
  afterEach(cleanup)

  test('keeps all-matching as an intent rather than expanding it into IDs', async () => {
    render(<CurationExplorer loadPage={async () => ({ items: makeRows(2), next_cursor: null, total: 50_000 })} />)
    await screen.findByText('Restaurant 1')

    fireEvent.click(screen.getByRole('button', { name: 'Select all matching results' }))

    expect(screen.getByRole('status').textContent).toMatch(/50,000 matching Curations selected/i)
    expect(screen.queryByText(/50,000 IDs/i)).toBeNull()
  })
})
