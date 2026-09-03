import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ExplorerSavedViews } from '../../../src/components/explorer/ExplorerSavedViews'
import type { SavedCurationViewsClient } from '../../../src/explorer/saved-views-client'

function client(overrides: Partial<SavedCurationViewsClient> = {}): SavedCurationViewsClient {
  return {
    list: vi.fn().mockResolvedValue([
      { id: 'view-1', name: 'Victoria drafts', normalizedFilters: { city: 'Victoria', status: ['draft'] }, sort: null, visibleColumns: null },
    ]),
    create: vi.fn().mockResolvedValue({
      id: 'view-2', name: 'Current', normalizedFilters: { status: ['active'] }, sort: null, visibleColumns: null,
    }),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

afterEach(() => cleanup())

test('applies a private saved view and can delete it', async () => {
  const onApply = vi.fn()
  const api = client()
  render(<ExplorerSavedViews currentFilters={{}} client={api} onApply={onApply} />)

  const select = await screen.findByLabelText('Saved view')
  fireEvent.change(select, { target: { value: 'view-1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply saved view' }))
  expect(onApply).toHaveBeenCalledWith({ city: 'Victoria', status: ['draft'] })

  fireEvent.click(screen.getByRole('button', { name: 'Delete saved view' }))
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith('view-1'))
  expect(screen.queryByText('Victoria drafts')).toBeNull()
})

test('saves only the normalized filters currently applied', async () => {
  const create = vi.fn().mockResolvedValue({
    id: 'view-2', name: 'Active Victoria', normalizedFilters: { city: 'Victoria', status: ['active'] }, sort: null, visibleColumns: null,
  })
  render(<ExplorerSavedViews
    currentFilters={{ city: 'Victoria', status: ['active'] }}
    client={client({ create })}
    onApply={vi.fn()}
  />)

  await screen.findByLabelText('Saved view')
  fireEvent.change(screen.getByLabelText('New view name'), { target: { value: ' Active Victoria ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save current view' }))

  await waitFor(() => expect(create).toHaveBeenCalledWith('Active Victoria', { city: 'Victoria', status: ['active'] }))
  expect(await screen.findByRole('option', { name: 'Active Victoria' })).toBeVisible()
})
