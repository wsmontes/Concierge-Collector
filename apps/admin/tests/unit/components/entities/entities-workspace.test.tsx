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
    ...overrides,
  }
}

function page(items: EntityRow[], nextCursor: string | null = null) {
  return Promise.resolve({ items, next_cursor: nextCursor, total: items.length })
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest('[role="row"]')
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

test('shows no Collections column: the Entity boundary carries no membership', async () => {
  render(<EntitiesWorkspace loadPage={() => page([entity()])} />)
  await screen.findByText('Ritz Restaurant')

  const headers = screen.getAllByRole('columnheader').map((node) => node.textContent)
  expect(headers).toEqual(['Entity', 'Type', 'City (derived)', 'Status', 'Curations', 'Updated'])
  expect(headers).not.toContain('Collections')
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

test('the preview drawer shows the loaded record, links to the full Entity and closes on Escape', async () => {
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

  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('the preview drawer reports a rejected record load', async () => {
  const loadRecord = vi.fn().mockRejectedValue(new Error('entity_unavailable'))
  render(<EntitiesWorkspace loadPage={() => page([entity()])} loadRecord={loadRecord} />)
  await screen.findByText('Ritz Restaurant')

  fireEvent.click(screen.getByText('Ritz Restaurant'))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Unable to load this Entity. Try again.')
})

test('distinguishes an empty catalog from an empty filter result', async () => {
  render(<EntitiesWorkspace loadPage={() => Promise.resolve({ items: [], next_cursor: null, total: 0 })} />)
  await waitFor(() => expect(screen.getByRole('heading', { name: 'No Entities yet' })).toBeVisible())

  fireEvent.change(screen.getByLabelText('Search Entities'), { target: { value: 'zzz' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

  expect(await screen.findByRole('heading', { name: 'No Entities match' })).toBeVisible()
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
