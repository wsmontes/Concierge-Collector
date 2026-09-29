import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CurationExplorer } from '../../../src/components/explorer/CurationExplorer'
import type { SavedCurationViewsClient } from '../../../src/explorer/saved-views-client'
import { makeRows } from '../../support/factories'

const emptyViews: SavedCurationViewsClient = {
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  remove: vi.fn(),
}

afterEach(() => cleanup())

test('filter draft changes do not reload until Apply; Apply normalizes and Clear resets', async () => {
  const loadPage = vi.fn().mockResolvedValue({ items: makeRows(2), next_cursor: null, total: 2 })
  render(<CurationExplorer loadPage={loadPage} savedViewsClient={emptyViews} />)
  await screen.findByText('Restaurant 1')
  expect(loadPage).toHaveBeenCalledTimes(1)

  fireEvent.change(screen.getByLabelText('Search Curations'), { target: { value: ' Sushi ' } })
  fireEvent.change(screen.getByLabelText('City'), { target: { value: ' Victoria ' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Draft' }))
  expect(loadPage).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
  await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
  expect(loadPage.mock.calls[1][0]).toEqual({
    cursor: null,
    filters: { q: 'sushi', city: 'Victoria', status: ['draft'] },
  })

  fireEvent.click(screen.getByLabelText('Select Restaurant 1'))
  expect(screen.getByRole('status').textContent).toMatch(/1 Curation selected/)

  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(3))
  expect(loadPage.mock.calls[2][0]).toEqual({ cursor: null, filters: {} })
  expect(screen.getByRole('status').textContent).toMatch(/0 Curations selected/)
})

test('applying a saved view uses its normalized filters and resets explicit selection', async () => {
  const views: SavedCurationViewsClient = {
    list: vi.fn().mockResolvedValue([
      { id: 'view-1', name: 'Linked Victoria', normalizedFilters: { city: 'Victoria', status: ['linked'] }, sort: null, visibleColumns: null },
    ]),
    create: vi.fn(),
    remove: vi.fn(),
  }
  const loadPage = vi.fn().mockResolvedValue({ items: makeRows(2), next_cursor: null, total: 2 })
  render(<CurationExplorer loadPage={loadPage} savedViewsClient={views} />)
  await screen.findByText('Restaurant 1')

  fireEvent.click(screen.getByLabelText('Select Restaurant 1'))
  expect(screen.getByRole('status').textContent).toMatch(/1 Curation selected/)

  fireEvent.change(await screen.findByLabelText('Saved view'), { target: { value: 'view-1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply saved view' }))

  await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
  expect(loadPage.mock.calls[1][0]).toEqual({ cursor: null, filters: { city: 'Victoria', status: ['linked'] } })
  expect(screen.getByRole('status').textContent).toMatch(/0 Curations selected/)
})
