import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CurationExplorer } from '../../../src/components/explorer/CurationExplorer'
import type { SavedCurationViewsClient } from '../../../src/explorer/saved-views-client'
import { makeRows } from '../../support/factories'

const savedViewsClient: SavedCurationViewsClient = {
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  remove: vi.fn(),
}

describe('CurationExplorer selection', () => {
  afterEach(cleanup)

  test('keeps all-matching as an intent rather than expanding it into IDs', async () => {
    render(<CurationExplorer savedViewsClient={savedViewsClient} loadPage={async () => ({ items: makeRows(2), next_cursor: null, total: 50_000 })} />)
    await screen.findByText('Restaurant 1')

    fireEvent.click(screen.getByRole('button', { name: 'Select all matching results' }))

    expect(screen.getByRole('status').textContent).toMatch(/50,000 matching Curations selected/i)
    expect(screen.queryByText(/50,000 IDs/i)).toBeNull()
  })

  test('shift-click selects only the loaded range', async () => {
    render(<CurationExplorer savedViewsClient={savedViewsClient} loadPage={async () => ({ items: makeRows(5), next_cursor: 'cursor-2', total: 100 })} />)
    await screen.findByText('Restaurant 1')

    const row0 = screen.getByLabelText('Select Restaurant 1')
    const row3 = screen.getByLabelText('Select Restaurant 4')
    expect(screen.getByLabelText('Select all loaded Curations')).toBeInTheDocument()

    fireEvent.click(row0)
    fireEvent.click(row3, { shiftKey: true })

    expect(screen.getByRole('status').textContent).toMatch(/4 Curations selected/)
  })

  test('"a" shortcut selects all matching, but never while typing in an editable target', async () => {
    render(<CurationExplorer savedViewsClient={savedViewsClient} loadPage={async () => ({ items: makeRows(3), next_cursor: null, total: 3 })} />)
    await screen.findByText('Restaurant 1')

    const search = screen.getByLabelText('Search Curations')
    fireEvent.keyDown(search, { key: 'a' })
    expect(screen.getByRole('status').textContent).toMatch(/0 Curations selected/)

    const section = search.closest('section') as HTMLElement
    fireEvent.keyDown(section, { key: 'a' })
    expect(screen.getByRole('status').textContent).toMatch(/3 matching Curations selected/)
  })

  test('header checkbox toggles every loaded row in explicit mode', async () => {
    render(<CurationExplorer savedViewsClient={savedViewsClient} loadPage={async () => ({ items: makeRows(3), next_cursor: null, total: 10 })} />)
    await screen.findByText('Restaurant 1')

    const header = screen.getByLabelText('Select all loaded Curations')
    fireEvent.click(header)
    expect(screen.getByRole('status').textContent).toMatch(/3 Curations selected/)

    fireEvent.click(header)
    expect(screen.getByRole('status').textContent).toMatch(/0 Curations selected/)
  })
})
