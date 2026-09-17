import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CurationsWorkspace } from '../../../src/components/curations/CurationsWorkspace'
import type { SavedCurationViewsClient } from '../../../src/explorer/saved-views-client'
import { makeRows } from '../../support/factories'

const savedViewsClient: SavedCurationViewsClient = {
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  remove: vi.fn(),
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/admin/curations')
})

function renderWorkspace(overrides: Partial<Parameters<typeof CurationsWorkspace>[0]> = {}) {
  return render(
    <CurationsWorkspace
      loadWithoutCollectionsCount={async () => 2491}
      loadPage={async () => ({ items: makeRows(2), next_cursor: null, total: 2 })}
      savedViewsClient={savedViewsClient}
      {...overrides}
    />,
  )
}

test('the filter turns the listing into the "Without Collections" view, and the URL says so', async () => {
  const loadPage = vi.fn().mockResolvedValue({ items: makeRows(2), next_cursor: null, total: null })
  const loadWithoutCollectionsCount = vi.fn().mockResolvedValue(2491)
  renderWorkspace({ loadPage, loadWithoutCollectionsCount })
  await screen.findByText('Restaurant 1')
  expect(loadPage.mock.calls[0][0].filters).toEqual({})

  fireEvent.click(screen.getByRole('checkbox', { name: 'Without Collections' }))
  // The draft does not narrow anything until Apply, exactly like every other filter.
  expect(loadPage).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

  await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
  expect(loadPage.mock.calls[1][0]).toEqual({
    cursor: null,
    filters: { without_collections: true },
    sort: 'updated_at_desc',
  })
  expect(window.location.search).toContain('without_collections=true')
  // The header count is the exhaustive content-health counter, never the page length.
  expect(await screen.findByText('2,491 without Collections')).toBeInTheDocument()
  expect(loadWithoutCollectionsCount).toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))

  await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(3))
  expect(loadPage.mock.calls[2][0].filters).toEqual({})
  expect(window.location.search).not.toContain('without_collections')
})

test('a deep link into the view boots the filter, the page and the counter', async () => {
  const loadPage = vi.fn().mockResolvedValue({ items: makeRows(1), next_cursor: null, total: null })
  renderWorkspace({ loadPage, initialQuery: '?without_collections=true' })

  await screen.findByText('Restaurant 1')
  expect(screen.getByRole('checkbox', { name: 'Without Collections' })).toBeChecked()
  expect(loadPage.mock.calls[0][0].filters).toEqual({ without_collections: true })
  expect(await screen.findByText('2,491 without Collections')).toBeInTheDocument()
})

test('an empty filtered page shows the empty state instead of an empty table', async () => {
  renderWorkspace({
    loadPage: async () => ({ items: [], next_cursor: null, total: null }),
    initialQuery: '?without_collections=true',
  })

  expect(await screen.findByText('No Curations without Collections')).toBeInTheDocument()
  expect(screen.getByText('No stored Curation in this view is missing from a Collection.')).toBeInTheDocument()
})

test('an unknown counter stays unknown rather than being invented', async () => {
  renderWorkspace({
    loadWithoutCollectionsCount: async () => null,
    loadPage: async () => ({ items: makeRows(1), next_cursor: null, total: null }),
    initialQuery: '?without_collections=true',
  })

  expect(await screen.findByText('Without Collections: —')).toBeInTheDocument()
})

test('"all matching" from the filtered view carries the view mode into the intent', async () => {
  const posted: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/admin/v1/selections') && init?.body) {
      posted.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return Response.json({ id: 'sel-1' }, { status: 202 })
    }
    return Response.json({ status: 'ready' })
  }))
  renderWorkspace({ initialQuery: '?without_collections=true&city=Victoria' })
  await screen.findByText('Restaurant 1')

  fireEvent.click(screen.getByRole('button', { name: 'Select all matching results' }))
  fireEvent.click(screen.getByRole('button', { name: 'Apply to Collections…' }))

  await waitFor(() => expect(posted).toHaveLength(1))
  expect(posted[0]).toEqual({
    mode: 'all_matching',
    filters: { city: 'Victoria', without_collections: true },
    excluded_ids: [],
  })
  vi.unstubAllGlobals()
})
