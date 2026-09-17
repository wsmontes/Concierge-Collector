import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CurationsWorkspace } from '../../../src/components/curations/CurationsWorkspace'
import type { SavedCurationViewsClient } from '../../../src/explorer/saved-views-client'
import { makeRows } from '../../support/factories'

const emptyViews: SavedCurationViewsClient = {
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  remove: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function queryFor(clauses: readonly unknown[], extra = ''): string {
  return clauses.map((clause) => `where=${encodeURIComponent(JSON.stringify(clause))}`).join('&') + extra
}

test('applying an advanced condition hands the clause set to the loader', async () => {
  const loadPage = vi.fn().mockResolvedValue({ items: makeRows(2), next_cursor: null, total: 2 })
  render(<CurationsWorkspace loadPage={loadPage} savedViewsClient={emptyViews} />)
  await screen.findByText('Restaurant 1')

  fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
  fireEvent.change(screen.getByLabelText('Filter 1 field'), { target: { value: 'curator_type' } })
  fireEvent.change(screen.getByLabelText('Filter 1 operator'), { target: { value: 'not_equals' } })
  fireEvent.change(screen.getByLabelText('Filter 1 value'), { target: { value: 'human' } })
  expect(loadPage).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

  await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
  expect(loadPage.mock.calls[1][0]).toEqual({
    cursor: null,
    filters: { where: [{ field: 'curator_type', op: 'not_equals', value: 'human' }] },
    sort: 'updated_at_desc',
  })
})

test('shows the applied conditions as chips and removes exactly one', async () => {
  const loadPage = vi.fn().mockResolvedValue({ items: makeRows(2), next_cursor: null, total: 2 })
  const query = queryFor([
    { field: 'notes.private', op: 'contains', value: 'anniversary' },
    { field: 'sources.audio', op: 'exists' },
  ])
  render(<CurationsWorkspace initialQuery={query} loadPage={loadPage} savedViewsClient={emptyViews} />)
  await screen.findByText('Restaurant 1')

  expect(screen.getByText('notes.private contains anniversary')).toBeVisible()
  expect(screen.getByText('sources.audio exists')).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Remove condition sources.audio exists' }))

  await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
  expect(loadPage.mock.calls[1][0].filters).toEqual({
    where: [{ field: 'notes.private', op: 'contains', value: 'anniversary' }],
  })
})

test('select-all-matching posts the advanced conditions with the intent', async () => {
  const clauses = [
    { field: 'curator_type', op: 'equals', value: 'synthetic' },
    { field: 'catalog_sequence', op: 'greater_than', value: 10 },
  ]
  const loadPage = vi.fn().mockResolvedValue({ items: makeRows(2), next_cursor: null, total: 42 })
  const posted: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = String(input)
    if (requestUrl.includes('/api/admin/v1/selections') && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return Response.json({ id: 'selection-1' })
    }
    if (requestUrl.includes('/api/admin/v1/selections/selection-1')) return Response.json({ status: 'ready' })
    return Response.json({ items: [] })
  }))

  render(<CurationsWorkspace
    initialQuery={queryFor(clauses, '&unlinked=true')}
    loadPage={loadPage}
    savedViewsClient={emptyViews}
  />)
  await screen.findByText('Restaurant 1')

  fireEvent.click(screen.getByRole('button', { name: 'Select all matching results' }))
  expect(screen.getByRole('status').textContent).toMatch(/42 matching Curations selected/i)

  fireEvent.click(screen.getByRole('button', { name: 'Apply to Collections…' }))

  await waitFor(() => expect(posted).toHaveLength(1), { timeout: 5_000 })
  // The intent carries the canonical clause set: the order the operator typed
  // is not what the manifest hashes.
  expect(posted[0]).toEqual({
    mode: 'all_matching',
    filters: {
      unlinked: true,
      where: [
        { field: 'catalog_sequence', op: 'greater_than', value: 10 },
        { field: 'curator_type', op: 'equals', value: 'synthetic' },
      ],
    },
    excluded_ids: [],
  })
})
