import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CurationExplorer } from '../../../src/components/explorer/CurationExplorer'
import { CurationsWorkspace } from '../../../src/components/curations/CurationsWorkspace'
import type { SavedCurationViewsClient } from '../../../src/explorer/saved-views-client'

const savedViewsClient: SavedCurationViewsClient = {
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  remove: vi.fn(),
}

const emptyPage = { items: [], next_cursor: null, total: 0 }

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('URL-backed Curation filters', () => {
  test('shows the filters restored from the URL in the form and the fetch', async () => {
    const loadPage = vi.fn().mockResolvedValue(emptyPage)

    render(<CurationExplorer
      initialFilters={{ q: 'ritz', status: ['active'], city: 'Victoria' }}
      loadPage={loadPage}
      savedViewsClient={savedViewsClient}
    />)

    expect(screen.getByLabelText('Search Curations')).toHaveValue('ritz')
    expect(screen.getByLabelText('City')).toHaveValue('Victoria')
    expect(screen.getByLabelText('Active')).toBeChecked()

    await waitFor(() => expect(loadPage).toHaveBeenCalled())
    expect(loadPage.mock.calls[0][0].filters).toMatchObject({ q: 'ritz', city: 'Victoria', status: ['active'] })
  })

  test('pushes the applied filters to the URL and drops them when cleared', async () => {
    window.history.replaceState(null, '', '/admin/curations')
    render(<CurationsWorkspace loadPage={vi.fn().mockResolvedValue(emptyPage)} savedViewsClient={savedViewsClient} />)

    const search = await screen.findByLabelText('Search Curations')
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(search, { target: { value: 'pizza' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    await waitFor(() => expect(window.location.search).toBe('?q=pizza'))

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  test('reads an existing query string on mount instead of fetching everything', async () => {
    window.history.replaceState(null, '', '/admin/curations?q=ritz&status=active')
    const loadPage = vi.fn().mockResolvedValue(emptyPage)

    render(<CurationsWorkspace loadPage={loadPage} savedViewsClient={savedViewsClient} />)

    await waitFor(() => expect(loadPage).toHaveBeenCalled())
    expect(loadPage.mock.calls[0][0].filters).toMatchObject({ q: 'ritz', status: ['active'] })
  })
})
