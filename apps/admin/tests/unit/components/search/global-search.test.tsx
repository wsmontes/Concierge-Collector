import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { GlobalSearch, type CollectionHit, type SearchResults } from '../../../../src/components/search/GlobalSearch'
import type { EntityRow } from '../../../../src/content/record-types'
import type { AdminCurationRow } from '../../../../src/explorer/types'

const ENTITY_ID = 'rest_1'
const CURATION_ID = 'cur_1'
const COLLECTION_ID = 'col_1'

const ENTITY_HREF = `/admin/entities/${ENTITY_ID}`
const CURATION_HREF = `/admin/curations/${CURATION_ID}`
const COLLECTION_HREF = `/admin/collections/collections/${COLLECTION_ID}`

function entity(overrides: Partial<EntityRow> = {}): EntityRow {
  return {
    id: ENTITY_ID,
    entity_id: 'ent-1',
    name: 'Ritz Restaurant',
    type: 'restaurant',
    status: 'active',
    city: 'São Paulo',
    updated_at: null,
    version: 3,
    curations_count: 2,
    ...overrides,
  }
}

function curation(overrides: Partial<AdminCurationRow> = {}): AdminCurationRow {
  return {
    catalog_sequence: 12,
    curation_id: CURATION_ID,
    status: 'active',
    restaurant_name: 'Ritz Restaurant',
    city: 'São Paulo',
    entity_type: 'restaurant',
    curator_id: 'usr_1',
    updated_at: null,
    ...overrides,
  }
}

function collection(overrides: Partial<CollectionHit> = {}): CollectionHit {
  return {
    id: COLLECTION_ID,
    slug: 'victoria',
    title: 'Victoria Ritz picks',
    lifecycle: 'published',
    draftSelectedCount: 3,
    ...overrides,
  }
}

function results(overrides: Partial<SearchResults> = {}): SearchResults {
  return { entities: [entity()], curations: [curation()], collections: [collection()], ...overrides }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

function renderPalette(loadResults: (query: string) => Promise<SearchResults>, navigate = vi.fn()) {
  render(<GlobalSearch loadResults={loadResults} navigate={navigate} />)
  return { navigate }
}

/** ⌘K, then the field it focuses: the only way into the palette in most tests. */
function openViaShortcut(): HTMLElement {
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
  return screen.getByRole('textbox', { name: 'Global search' })
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test('⌘K and Ctrl+K open the palette, Escape closes it, and focus follows', () => {
  renderPalette(vi.fn().mockResolvedValue(results()))
  expect(screen.queryByRole('dialog')).toBeNull()

  fireEvent.keyDown(window, { key: 'k', metaKey: true })
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Global search' })).toHaveFocus()

  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('button', { name: 'Global search' })).toHaveFocus()

  fireEvent.keyDown(window, { key: 'K', ctrlKey: true })
  expect(screen.getByRole('dialog')).toBeVisible()

  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('the visible control opens the same palette, idle and explicit', () => {
  renderPalette(vi.fn().mockResolvedValue(results()))

  fireEvent.click(screen.getByRole('button', { name: 'Global search' }))

  expect(screen.getByRole('dialog')).toBeVisible()
  expect(screen.getByText('Start typing to search Entities, Curations and Collections by name.')).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Global search' })).toHaveFocus()
})

test('typing settles into a single loader call', async () => {
  vi.useFakeTimers()
  const loadResults = vi.fn().mockResolvedValue(results())
  renderPalette(loadResults)
  const input = openViaShortcut()

  fireEvent.change(input, { target: { value: 'r' } })
  fireEvent.change(input, { target: { value: 'ri' } })
  fireEvent.change(input, { target: { value: 'ritz' } })

  await advance(200)
  expect(loadResults).not.toHaveBeenCalled()

  await advance(100)
  expect(loadResults).toHaveBeenCalledTimes(1)
  expect(loadResults).toHaveBeenCalledWith('ritz')
})

test('a slow stale answer never overwrites a newer one', async () => {
  vi.useFakeTimers()
  const slow = deferred<SearchResults>()
  const fresh = deferred<SearchResults>()
  const loadResults = vi.fn()
    .mockImplementationOnce(() => slow.promise)
    .mockImplementationOnce(() => fresh.promise)
  renderPalette(loadResults)
  const input = openViaShortcut()

  fireEvent.change(input, { target: { value: 'ritz' } })
  await advance(300)
  expect(loadResults).toHaveBeenCalledTimes(1)

  // The field is cleared and the same term typed again. Both requests answer
  // the same query, so only the request ticket can tell which answer is current.
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.change(input, { target: { value: 'ritz' } })
  await advance(300)
  expect(loadResults).toHaveBeenCalledTimes(2)
  expect(loadResults).toHaveBeenLastCalledWith('ritz')

  const newer = { entities: [entity({ id: 'rest_new', name: 'Newer Ritz' })], curations: [], collections: [] }
  const older = { entities: [entity({ id: 'rest_old', name: 'Stale Ritz' })], curations: [], collections: [] }

  await act(async () => { fresh.resolve(newer) })
  expect(screen.getByText('Newer Ritz')).toBeVisible()

  // The older request answers last and is dropped on arrival.
  await act(async () => { slow.resolve(older) })
  expect(screen.queryByText('Stale Ritz')).toBeNull()
  expect(screen.getByText('Newer Ritz')).toBeVisible()
})

test('groups render only for the families that answered', async () => {
  renderPalette(vi.fn().mockResolvedValue(results({ curations: [], collections: [] })))
  const input = openViaShortcut()
  fireEvent.change(input, { target: { value: 'ritz' } })

  expect(await screen.findByRole('heading', { name: 'ENTITIES' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'CURATIONS' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'COLLECTIONS' })).toBeNull()
})

test('all three families group under their headings, in reading order', async () => {
  renderPalette(vi.fn().mockResolvedValue(results()))
  const input = openViaShortcut()
  fireEvent.change(input, { target: { value: 'ritz' } })

  await screen.findByText('Victoria Ritz picks')

  expect(screen.getAllByRole('heading').map((node) => node.textContent)).toEqual([
    'ENTITIES',
    'CURATIONS',
    'COLLECTIONS',
  ])
})

test('every row leads with its human label and demotes the id', async () => {
  renderPalette(vi.fn().mockResolvedValue(results()))
  const input = openViaShortcut()
  fireEvent.change(input, { target: { value: 'ritz' } })
  await screen.findByText('Victoria Ritz picks')

  const options = screen.getAllByRole('option')
  expect(options).toHaveLength(3)
  // The first element of each row is the label — never the id.
  expect(options.map((option) => option.firstElementChild?.className)).toEqual([
    'search-palette__row-label',
    'search-palette__row-label',
    'search-palette__row-label',
  ])
  expect(options.map((option) => option.querySelector('.search-palette__row-label')?.textContent)).toEqual([
    'Ritz Restaurant',
    'Ritz Restaurant',
    'Victoria Ritz picks',
  ])
  expect(options.map((option) => option.querySelector('.search-palette__row-meta')?.textContent)).toEqual([
    'restaurant · São Paulo',
    'restaurant · active · São Paulo',
    'victoria · 3 in draft',
  ])
  expect(options.map((option) => option.querySelector('.search-palette__row-id')?.textContent)).toEqual([
    ENTITY_ID,
    CURATION_ID,
    COLLECTION_ID,
  ])
})

test('arrow keys and Enter open the right record kind', async () => {
  const { navigate } = renderPalette(vi.fn().mockResolvedValue(results()))
  const input = openViaShortcut()
  fireEvent.change(input, { target: { value: 'ritz' } })
  await screen.findByText('Victoria Ritz picks')

  // The first row is already active, and ArrowUp at the top cannot leave it.
  expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  expect(input).toHaveAttribute('aria-activedescendant', 'global-search-option-0')
  fireEvent.keyDown(input, { key: 'ArrowUp' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(navigate).toHaveBeenLastCalledWith(ENTITY_HREF)
  expect(screen.queryByRole('dialog')).toBeNull()

  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  const curationInput = screen.getByRole('textbox', { name: 'Global search' })
  fireEvent.change(curationInput, { target: { value: 'ritz' } })
  await screen.findByText('Victoria Ritz picks')
  fireEvent.keyDown(curationInput, { key: 'ArrowDown' })
  expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
  expect(screen.getAllByRole('option')[1].className).toContain('search-palette__row--active')
  fireEvent.keyDown(curationInput, { key: 'Enter' })
  expect(navigate).toHaveBeenLastCalledWith(CURATION_HREF)

  fireEvent.click(screen.getByRole('button', { name: 'Global search' }))
  const collectionInput = screen.getByRole('textbox', { name: 'Global search' })
  fireEvent.change(collectionInput, { target: { value: 'ritz' } })
  await screen.findByText('Victoria Ritz picks')
  fireEvent.keyDown(collectionInput, { key: 'ArrowDown' })
  fireEvent.keyDown(collectionInput, { key: 'ArrowDown' })
  fireEvent.keyDown(collectionInput, { key: 'Enter' })
  expect(navigate).toHaveBeenLastCalledWith(COLLECTION_HREF)
})

test('clicking a row opens it too', async () => {
  const { navigate } = renderPalette(vi.fn().mockResolvedValue(results()))
  const input = openViaShortcut()
  fireEvent.change(input, { target: { value: 'ritz' } })

  fireEvent.click(await screen.findByText('Victoria Ritz picks'))

  expect(navigate).toHaveBeenCalledWith(COLLECTION_HREF)
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('an explicit empty state replaces the results', async () => {
  renderPalette(vi.fn().mockResolvedValue(results({ entities: [], curations: [], collections: [] })))
  const input = openViaShortcut()
  fireEvent.change(input, { target: { value: 'nowhere' } })

  expect(await screen.findByText('No matches for “nowhere”.')).toBeVisible()
  expect(screen.queryAllByRole('option')).toHaveLength(0)
})

test('a pending query shows a loading state, never a blank panel', () => {
  const pending = deferred<SearchResults>()
  renderPalette(vi.fn().mockReturnValue(pending.promise))
  const input = openViaShortcut()

  fireEvent.change(input, { target: { value: 'ritz' } })

  expect(screen.getByRole('status')).toHaveTextContent('Searching…')
})

test('a failing query renders a visible error and stays retryable', async () => {
  const loadResults = vi.fn()
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce(results())
  renderPalette(loadResults)
  const input = openViaShortcut()
  fireEvent.change(input, { target: { value: 'ritz' } })

  expect(await screen.findByRole('alert')).toHaveTextContent('Search is unavailable right now. Try again.')
  expect(screen.getByRole('textbox', { name: 'Global search' })).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

  expect(await screen.findByText('Victoria Ritz picks')).toBeVisible()
  expect(screen.queryByRole('alert')).toBeNull()
})
