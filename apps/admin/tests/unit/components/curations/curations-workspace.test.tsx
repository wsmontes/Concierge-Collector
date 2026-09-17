import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CurationsWorkspace } from '../../../../src/components/curations/CurationsWorkspace'
import type { CurationRecordResponse } from '../../../../src/content/record-types'
import type { SavedCurationViewsClient } from '../../../../src/explorer/saved-views-client'
import { makeRows } from '../../../support/factories'

const emptyViews: SavedCurationViewsClient = {
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  remove: vi.fn(),
}

function page(count = 3) {
  return { items: makeRows(count), next_cursor: null, total: count }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CurationsWorkspace list states', () => {
  test('shows a skeleton instead of an empty state while the first page is in flight', () => {
    const { container } = render(<CurationsWorkspace
      loadPage={() => new Promise(() => {})}
      savedViewsClient={emptyViews}
    />)

    // Uma lista que ainda não respondeu não pode dizer que não há Curations.
    expect(screen.queryByText('No Curations yet')).toBeNull()
    expect(container.querySelectorAll('.ui-skeleton').length).toBeGreaterThan(0)
  })

  test('a failed page offers a retry that reads the page again', async () => {
    const loadPage = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(page(2))
    render(<CurationsWorkspace loadPage={loadPage} savedViewsClient={emptyViews} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Curations could not load')

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Restaurant 1')).toBeVisible()
    expect(loadPage).toHaveBeenCalledTimes(2)
  })
})

describe('CurationsWorkspace URL state', () => {
  test('boots from the server query string and mirrors it back into the URL', async () => {
    const loadPage = vi.fn().mockResolvedValue(page())
    render(<CurationsWorkspace
      initialQuery="status=active&concept.Mood=Casual&sort=name_asc&columns=curation,created"
      loadPage={loadPage}
      savedViewsClient={emptyViews}
    />)
    await screen.findByText('Restaurant 1')

    expect(loadPage).toHaveBeenCalledWith({
      cursor: null,
      filters: { status: ['active'], concepts: [{ category: 'Mood', value: 'Casual' }] },
      sort: 'name_asc',
    })
    expect(screen.getByRole('columnheader', { name: 'Created' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'City' })).toBeNull()
    expect(decodeURIComponent(window.location.search)).toBe('?status=active&concept.Mood=Casual&sort=name_asc&columns=curation,created')
  })

  test('a sort change reloads with the new sort and lands in the URL', async () => {
    const loadPage = vi.fn().mockResolvedValue(page())
    render(<CurationsWorkspace loadPage={loadPage} savedViewsClient={emptyViews} />)
    await screen.findByText('Restaurant 1')
    expect(loadPage.mock.calls[0][0]).toEqual({ cursor: null, filters: {}, sort: 'updated_at_desc' })

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name_asc' } })

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
    expect(loadPage.mock.calls[1][0]).toEqual({ cursor: null, filters: {}, sort: 'name_asc' })
    await waitFor(() => expect(window.location.search).toBe('?sort=name_asc'))
  })

  test('toggling a column shows the cell, persists it in the URL and does not reload the list', async () => {
    const loadPage = vi.fn().mockResolvedValue(page(1))
    const { container } = render(<CurationsWorkspace loadPage={loadPage} savedViewsClient={emptyViews} />)
    await screen.findByText('Restaurant 1')
    expect(screen.queryByRole('columnheader', { name: 'Created' })).toBeNull()

    fireEvent.click(screen.getByLabelText('Created'))

    expect(screen.getByRole('columnheader', { name: 'Created' })).toBeInTheDocument()
    expect(container.querySelector('tr[data-row] td[data-label="Created"]')).toHaveTextContent('—')
    expect(loadPage).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(decodeURIComponent(window.location.search)).toContain(
      'columns=curation,curator,type,city,concepts,collections,state,updated,created',
    ))

    fireEvent.click(screen.getByLabelText('Created'))
    expect(screen.queryByRole('columnheader', { name: 'Created' })).toBeNull()
    expect(loadPage).toHaveBeenCalledTimes(1)
  })

  test('paging keeps the sort that minted the cursor, and changing the sort drops the cursor', async () => {
    const loadPage = vi.fn()
      .mockResolvedValueOnce({ items: makeRows(2), next_cursor: 'cursor-2', total: 4 })
      .mockResolvedValue({ items: makeRows(2), next_cursor: null, total: 4 })
    render(<CurationsWorkspace loadPage={loadPage} savedViewsClient={emptyViews} />)
    await screen.findByText('Restaurant 1')

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
    expect(loadPage.mock.calls[1][0]).toEqual({ cursor: 'cursor-2', filters: {}, sort: 'updated_at_desc' })
    await waitFor(() => expect(window.location.search).toBe('?cursor=cursor-2'))

    // A cursor is bound to the sort that minted it: a new sort must start over.
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name_asc' } })
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(3))
    expect(loadPage.mock.calls[2][0]).toEqual({ cursor: null, filters: {}, sort: 'name_asc' })
    await waitFor(() => expect(window.location.search).toBe('?sort=name_asc'))
  })

  test('keeps the concept facet in the URL and drops it when the chip is removed', async () => {
    const loadPage = vi.fn().mockResolvedValue(page())
    render(<CurationsWorkspace initialQuery="concept.Mood=Casual&collection=abc123" loadPage={loadPage} savedViewsClient={emptyViews} />)
    await screen.findByText('Restaurant 1')

    expect(screen.getByText('Mood: Casual')).toBeInTheDocument()
    expect(window.location.search).toBe('?collection=abc123&concept.Mood=Casual')

    fireEvent.click(screen.getByRole('button', { name: 'Remove Mood: Casual' }))

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
    expect(loadPage.mock.calls[1][0]).toEqual({ cursor: null, filters: {}, sort: 'updated_at_desc' })
    await waitFor(() => expect(window.location.search).toBe('?collection=abc123'))
  })
})

describe('CurationsWorkspace preview', () => {
  const record: CurationRecordResponse = {
    record: {
      curation_id: 'curation-1',
      restaurant_name: 'Ritz Restaurant',
      entity_id: '507f1f77bcf86cd799439011',
      status: 'active',
      curator_type: 'human',
      city: 'São Paulo',
      type: 'restaurant',
      notes: { public: 'Ask for the corner table.' },
      categories: { Mood: ['Casual'] },
      sources: { audio: [{}], image: [{}] },
      updatedAt: '2026-09-11T10:00:00.000Z',
    },
    collections: [],
  }

  test('a row click opens the drawer with the loaded record while a checkbox click does not', async () => {
    const loadRecord = vi.fn().mockResolvedValue(record)
    render(<CurationsWorkspace loadPage={vi.fn().mockResolvedValue(page(2))} loadRecord={loadRecord} savedViewsClient={emptyViews} />)
    await screen.findByText('Restaurant 1')

    fireEvent.click(screen.getByLabelText('Select Restaurant 1'))
    expect(loadRecord).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByText('Restaurant 1'))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Ask for the corner table.')
    expect(loadRecord).toHaveBeenCalledWith('curation-1')
    expect(screen.getByRole('link', { name: 'Open full Curation' })).toHaveAttribute('href', '/admin/curations/curation-1')

    // O `Esc` é o contrato de dispensa da gaveta (o kit o trata também no
    // caminho sem `ModalProvider`, que é o do jsdom).
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // E a ação de fechar da própria gaveta continua sendo o `onClose` da tela.
    fireEvent.click(screen.getByText('Restaurant 1'))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('surfaces the drawer error state when the record loader rejects', async () => {
    const loadRecord = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(record)
    render(<CurationsWorkspace
      loadPage={vi.fn().mockResolvedValue(page(1))}
      loadRecord={loadRecord}
      savedViewsClient={emptyViews}
    />)
    await screen.findByText('Restaurant 1')

    fireEvent.click(screen.getByText('Restaurant 1'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load this Curation.')

    // O retry relê o registro em vez de só redesenhar a mensagem.
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Open full Curation' })).toHaveAttribute(
      'href',
      '/admin/curations/curation-1',
    )
    expect(loadRecord).toHaveBeenCalledTimes(2)
  })
})

describe('CurationsWorkspace browser loader', () => {
  test('always sends the sort explicitly and repeats concept keys as a conjunction', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ items: [], next_cursor: null, total: 0 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetcher)

    render(<CurationsWorkspace initialQuery="concept.Mood=Casual&concept.Mood=Business&city=Victoria" savedViewsClient={emptyViews} />)

    await waitFor(() => expect(fetcher).toHaveBeenCalled())
    const request = new URL(String(fetcher.mock.calls[0][0]))
    expect(request.pathname).toBe('/api/admin/v1/curations')
    // The API default is its historical ordering, so the list must name the sort.
    expect(request.searchParams.get('sort')).toBe('updated_at_desc')
    expect(request.searchParams.get('city')).toBe('Victoria')
    expect(request.searchParams.getAll('concept.Mood')).toEqual(['Business', 'Casual'])
    vi.unstubAllGlobals()
  })
})

describe('CurationsWorkspace saved views', () => {
  test('re-applying a view restores its filters, sort and columns', async () => {
    const views: SavedCurationViewsClient = {
      list: vi.fn().mockResolvedValue([{
        id: 'view-1',
        name: 'Victoria + Created',
        normalizedFilters: { city: 'Victoria' },
        sort: { id: 'name_asc' },
        visibleColumns: ['curation', 'created'],
      }]),
      create: vi.fn(),
      remove: vi.fn(),
    }
    const loadPage = vi.fn().mockResolvedValue(page())
    render(<CurationsWorkspace loadPage={loadPage} savedViewsClient={views} />)
    await screen.findByText('Restaurant 1')
    expect(screen.queryByRole('columnheader', { name: 'Created' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Views' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Victoria \+ Created/ }))

    await waitFor(() => expect(loadPage).toHaveBeenLastCalledWith({ cursor: null, filters: { city: 'Victoria' }, sort: 'name_asc' }))
    expect(screen.getByLabelText('City', { selector: 'input:not([type="checkbox"])' })).toHaveValue('Victoria')
    expect(screen.getByRole('columnheader', { name: 'Created' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Curator' })).toBeNull()
  })
})
