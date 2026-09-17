import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { EntitiesWorkspace } from '../../../../src/components/entities/EntitiesWorkspace'
import type { EntityRow } from '../../../../src/content/record-types'

const ENTITY_ID = '507f1f77bcf86cd799439011'

function entity(overrides: Partial<EntityRow> = {}): EntityRow {
  return {
    id: ENTITY_ID,
    entity_id: 'ent-1',
    name: 'Ritz Restaurant',
    type: 'restaurant',
    status: 'active',
    city: 'São Paulo',
    updated_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    version: 3,
    curations_count: 2,
    collections_count: 3,
    ...overrides,
  }
}

function page(items: EntityRow[], nextCursor: string | null = null) {
  return Promise.resolve({ items, next_cursor: nextCursor, total: items.length })
}

/** The row that holds a name. The table is a real `<table>`, so the row is its `tr`. */
function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr')
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${name}`)
  return row
}

beforeEach(() => {
  window.history.replaceState(null, '', '/admin/entities')
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

test('renders the Entity page the injected loader returns, with the plan’s columns', async () => {
  const loadPage = vi.fn(() => page([entity()]))
  render(<EntitiesWorkspace loadPage={loadPage} />)

  expect(await screen.findByText('Ritz Restaurant')).toBeVisible()
  expect(screen.getByText('ent-1')).toBeVisible()
  expect(screen.getByText('São Paulo')).toBeVisible()
  expect(loadPage).toHaveBeenCalledWith({ cursor: null, query: '', type: null, status: null })
})

test('reads the list through the shared table, named for the screen reader', async () => {
  render(<EntitiesWorkspace loadPage={() => page([entity()])} />)
  await screen.findByText('Ritz Restaurant')

  const table = screen.getByRole('table', { name: 'Entities' })
  // Cada coluna tem o rótulo que o cartão empilhado do mobile usa.
  expect(within(table).getAllByRole('columnheader').map((node) => node.textContent)).toEqual([
    'Entity', 'Type', 'City (derived)', 'Status', 'Curations', 'Collections', 'Updated',
  ])
  // O `data-label` é o contrato do modo cartão abaixo de 900px.
  expect(within(table).getByText('Ritz Restaurant').closest('td')).toHaveAttribute('data-label', 'Entity')
})

test('shows the Collections column with the joined count, an em dash when unknown', async () => {
  const rows = [
    entity({ id: 'a', name: 'Joined Entity', collections_count: 3 }),
    entity({ id: 'b', name: 'Known Zero', collections_count: 0 }),
    entity({ id: 'c', name: 'Unjoined Entity', collections_count: null }),
  ]
  render(<EntitiesWorkspace loadPage={() => page(rows)} />)
  await screen.findByText('Joined Entity')

  expect(within(rowOf('Joined Entity')).getByText('3')).toBeVisible()
  expect(within(rowOf('Known Zero')).getByText('0')).toBeVisible()
  expect(within(rowOf('Unjoined Entity')).getByText('—')).toBeVisible()
})

test('renders an explicit em dash for a missing Curation count, never 0 or blank', async () => {
  const rows = [
    entity({ id: 'a', name: 'Unknown Count', entity_id: null, curations_count: null }),
    entity({ id: 'b', name: 'Zero Count', curations_count: 0 }),
  ]
  render(<EntitiesWorkspace loadPage={() => page(rows)} />)
  await screen.findByText('Unknown Count')

  expect(within(rowOf('Unknown Count')).getByText('—')).toBeVisible()
  expect(within(rowOf('Zero Count')).getByText('0')).toBeVisible()
})

test('a non-zero Curation count links to the Entity record', async () => {
  render(<EntitiesWorkspace loadPage={() => page([entity({ curations_count: 5 })])} />)
  await screen.findByText('Ritz Restaurant')

  expect(within(rowOf('Ritz Restaurant')).getByRole('link', { name: '5' })).toHaveAttribute(
    'href',
    `/admin/entities/${ENTITY_ID}`,
  )
  expect(within(rowOf('Ritz Restaurant')).queryByRole('checkbox')).toBeNull()
})

test('rows carry a relative date whose title is the absolute one', async () => {
  const updatedAt = new Date(Date.now() - 2 * 3600_000).toISOString()
  render(<EntitiesWorkspace loadPage={() => page([entity({ updated_at: updatedAt })])} />)
  await screen.findByText('Ritz Restaurant')

  const time = within(rowOf('Ritz Restaurant')).getByText('2 hours ago').closest('time')
  expect(time).toHaveAttribute('datetime', updatedAt)
  expect(time?.getAttribute('title')).not.toBeNull()
})

test('applying filters rewrites the URL and refetches with the new query', async () => {
  const loadPage = vi.fn(() => page([entity()]))
  render(<EntitiesWorkspace loadPage={loadPage} />)
  await screen.findByText('Ritz Restaurant')

  fireEvent.change(screen.getByLabelText('Search Entities'), { target: { value: ' ritz ' } })
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'restaurant' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

  await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
  expect(loadPage.mock.calls[1][0]).toEqual({ cursor: null, query: 'ritz', type: 'restaurant', status: null })
  expect(window.location.search).toBe('?q=ritz&type=restaurant')

  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
  await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(3))
  expect(loadPage.mock.calls[2][0]).toEqual({ cursor: null, query: '', type: null, status: null })
  expect(window.location.search).toBe('')
  expect(screen.getByLabelText('Search Entities')).toHaveValue('')
})

test('the filter bar is one labelled toolbar, not a stack of boxes', async () => {
  render(<EntitiesWorkspace loadPage={() => page([entity()])} />)
  await screen.findByText('Ritz Restaurant')

  const form = screen.getByRole('form', { name: 'Entity filters' })
  expect(within(form).getByLabelText('Search Entities')).toBeVisible()
  expect(within(form).getByLabelText('Type')).toHaveValue('')
  expect(within(form).getByLabelText('Status')).toHaveValue('')
  // O enum do filtro é o do registro de campos, nunca uma segunda lista.
  expect(within(form).getAllByRole('option', { name: 'restaurant' })).toHaveLength(1)
  expect(within(form).getByRole('option', { name: 'All statuses' })).toBeVisible()
})

test('honours a deep link on mount', async () => {
  const loadPage = vi.fn(() => page([entity()]))
  render(<EntitiesWorkspace initialQuery="?q=ritz&type=restaurant" loadPage={loadPage} />)

  await waitFor(() => expect(loadPage).toHaveBeenCalledWith({
    cursor: null,
    query: 'ritz',
    type: 'restaurant',
    status: null,
  }))
  expect(screen.getByLabelText('Search Entities')).toHaveValue('ritz')
  expect(screen.getByLabelText('Type')).toHaveValue('restaurant')
  expect(window.location.search).toBe('?q=ritz&type=restaurant')
})

test('keeps unknown query keys across a filter change', async () => {
  render(<EntitiesWorkspace initialQuery="?utm_source=news&q=ritz" loadPage={() => page([entity()])} />)
  await screen.findByText('Ritz Restaurant')

  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

  await waitFor(() => expect(window.location.search).toBe('?utm_source=news&q=ritz&status=draft'))
})

test('arrow keys move the active row and Enter opens the preview', async () => {
  const rows = [entity({ id: 'a', name: 'Alpha' }), entity({ id: 'b', name: 'Beta' })]
  const loadRecord = vi.fn().mockResolvedValue({ record: { name: 'Beta' } })
  render(<EntitiesWorkspace loadPage={() => page(rows)} loadRecord={loadRecord} />)
  await screen.findByText('Alpha')

  const table = screen.getByRole('table', { name: 'Entities' })
  fireEvent.keyDown(table, { key: 'ArrowDown' })
  fireEvent.keyDown(table, { key: 'ArrowDown' })
  fireEvent.keyDown(table, { key: 'Enter' })

  expect(await screen.findByRole('dialog')).toBeVisible()
  expect(loadRecord).toHaveBeenCalledWith('b')
})

test('the preview drawer shows the loaded record, links to the full Entity and closes', async () => {
  const loadRecord = vi.fn().mockResolvedValue({
    record: {
      name: 'Beta Bar',
      type: 'bar',
      status: 'draft',
      externalId: 'ext-9',
      data: { city: 'Lisbon' },
      metadata: [{ type: 'osm', source: 'openstreetmap' }],
      curations_count: 4,
      updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    },
  })
  render(<EntitiesWorkspace loadPage={() => page([entity({ id: 'b', name: 'Beta Bar' })])} loadRecord={loadRecord} />)
  await screen.findByText('Beta Bar')

  fireEvent.click(screen.getByText('Beta Bar'))
  const drawer = await screen.findByRole('dialog')

  expect(within(drawer).getByRole('heading', { name: 'Beta Bar' })).toBeVisible()
  expect(within(drawer).getByText('ext-9')).toBeVisible()
  expect(within(drawer).getByText('Lisbon')).toBeVisible()
  expect(within(drawer).getByText('openstreetmap')).toBeVisible()
  expect(within(drawer).getByText('4 Curations about this Entity')).toBeVisible()
  expect(within(drawer).getByText('2 hours ago')).toBeVisible()
  expect(within(drawer).getByRole('link', { name: 'Open full Entity' })).toHaveAttribute(
    'href',
    '/admin/entities/b',
  )

  // Fechar é do botão do cabeçalho (o `Esc` e o clique fora são do provider do
  // Payload, que só existe no browser — medidos lá, não aqui).
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('the preview reports its own read while it loads, not an empty record', async () => {
  const pending = Promise.withResolvers<{ record: Record<string, unknown> }>()
  const loadRecord = vi.fn(() => pending.promise)
  render(<EntitiesWorkspace loadPage={() => page([entity({ id: 'b', name: 'Beta Bar' })])} loadRecord={loadRecord} />)
  await screen.findByText('Beta Bar')

  fireEvent.click(screen.getByText('Beta Bar'))

  expect(await screen.findByText('Loading Entity…')).toHaveAttribute('role', 'status')
  pending.resolve({ record: { name: 'Beta Bar', data: { city: 'Lisbon' } } })
  expect(await screen.findByText('Lisbon')).toBeVisible()
})

test('the preview drawer reports a rejected record load', async () => {
  const loadRecord = vi.fn().mockRejectedValue(new Error('entity_unavailable'))
  render(<EntitiesWorkspace loadPage={() => page([entity()])} loadRecord={loadRecord} />)
  await screen.findByText('Ritz Restaurant')

  fireEvent.click(screen.getByText('Ritz Restaurant'))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Unable to load this Entity. Try again.')
  expect(screen.queryByRole('link', { name: 'Open full Entity' })).toBeNull()
})

test('distinguishes an empty catalog from an empty filter result', async () => {
  render(<EntitiesWorkspace loadPage={() => Promise.resolve({ items: [], next_cursor: null, total: 0 })} />)
  await waitFor(() => expect(screen.getByRole('heading', { name: 'No Entities yet' })).toBeVisible())
  // Catálogo vazio não tem filtro para limpar: nenhuma ação inventada.
  expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()

  fireEvent.change(screen.getByLabelText('Search Entities'), { target: { value: 'zzz' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

  expect(await screen.findByRole('heading', { name: 'No Entities match' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Clear filters' })).toBeVisible()
})

test('a filtered empty state clears the filters it is complaining about', async () => {
  const loadPage = vi.fn(() => Promise.resolve({ items: [], next_cursor: null, total: 0 }))
  render(<EntitiesWorkspace initialQuery="?q=zzz" loadPage={loadPage} />)
  await screen.findByRole('heading', { name: 'No Entities match' })

  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

  await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
  expect(loadPage.mock.calls[1][0]).toEqual({ cursor: null, query: '', type: null, status: null })
  expect(window.location.search).toBe('')
})

test('renders a skeleton plus one announced status while the first page loads', async () => {
  render(<EntitiesWorkspace loadPage={() => Promise.withResolvers<never>().promise} />)

  expect(screen.getByText('Loading Entities…')).toHaveAttribute('role', 'status')
  expect(screen.getByRole('table', { name: 'Entities' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'No Entities yet' })).toBeNull()
})

test('offers a retry when the list read fails, and reloads on it', async () => {
  const loadPage = vi.fn()
    .mockRejectedValueOnce(new Error('entity_unavailable'))
    .mockResolvedValueOnce({ items: [entity()], next_cursor: null, total: 1 })
  render(<EntitiesWorkspace loadPage={loadPage} />)

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Unable to load Entities')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

  expect(await screen.findByText('Ritz Restaurant')).toBeVisible()
  expect(loadPage).toHaveBeenCalledTimes(2)
})

test('Next page requests the cursor and disappears when the page carries none', async () => {
  const loadPage = vi.fn()
    .mockResolvedValueOnce({ items: [entity({ name: 'Alpha' })], next_cursor: 'cursor-2', total: 3 })
    .mockResolvedValueOnce({ items: [entity({ name: 'Beta' })], next_cursor: null, total: 3 })
  render(<EntitiesWorkspace loadPage={loadPage} />)
  await screen.findByText('Alpha')

  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

  await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
  expect(loadPage.mock.calls[1][0]).toEqual({ cursor: 'cursor-2', query: '', type: null, status: null })
  expect(window.location.search).toBe('?cursor=cursor-2')
  expect(await screen.findByText('Beta')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
})
