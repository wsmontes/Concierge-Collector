import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CurationsSavedViews } from '../../../src/components/curations/CurationsSavedViews'
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
  render(<CurationsSavedViews client={api} currentColumns={['curation']} currentFilters={{}} currentSort="updated_at_desc" onApply={onApply} />)

  const view = { id: 'view-1', name: 'Victoria drafts', normalizedFilters: { city: 'Victoria', status: ['draft'] }, sort: null, visibleColumns: null }
  fireEvent.click(screen.getByRole('button', { name: 'Views' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: /Victoria drafts/ }))
  expect(onApply).toHaveBeenCalledWith(expect.objectContaining(view))

  // A view só pode ser apagada depois de escolhida: o item nomeia exatamente a
  // que está em uso, em vez de depender de uma seleção paralela.
  fireEvent.click(screen.getByRole('button', { name: 'Views' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: /Delete “Victoria drafts”/ }))
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith('view-1'))
  expect(screen.queryByText('Victoria drafts')).toBeNull()
})

test('saves the applied filters together with the sort and the visible columns', async () => {
  const create = vi.fn().mockResolvedValue({
    id: 'view-2', name: 'Active Victoria', normalizedFilters: { city: 'Victoria', status: ['active'] }, sort: null, visibleColumns: null,
  })
  render(<CurationsSavedViews
    client={client({ create })}
    currentColumns={['curation', 'city', 'created']}
    currentFilters={{ city: 'Victoria', status: ['active'] }}
    currentSort="name_asc"
    onApply={vi.fn()}
  />)

  fireEvent.click(screen.getByRole('button', { name: 'Views' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: /Save current view/ }))
  fireEvent.change(screen.getByLabelText('New view name'), { target: { value: ' Active Victoria ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save current view' }))

  await waitFor(() => expect(create).toHaveBeenCalledWith(
    'Active Victoria',
    { city: 'Victoria', status: ['active'] },
    { sort: 'name_asc', visibleColumns: ['curation', 'city', 'created'] },
  ))

  fireEvent.click(screen.getByRole('button', { name: 'Views' }))
  expect(await screen.findByRole('menuitem', { name: /^Active Victoria/ })).toBeVisible()
})
