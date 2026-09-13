import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { ContentFieldInspector } from '../../../src/components/content/ContentFieldInspector'

afterEach(cleanup)

const curations = {
  _id: '507f1f77bcf86cd799439011',
  title: 'Victoria Island',
  status: 'published',
  location: { city: 'Saanich', postal_code: 'V8V' },
  unmapped: { inner_code: 'ABC-123' },
}

function path(query: string): HTMLElement {
  return screen.getByText(query, { selector: 'code' })
}

/** The row holding a field path; disclosure state lives on that row only. */
function rowOf(fieldPath: string): HTMLElement {
  return path(fieldPath).closest('li') as HTMLElement
}

function searchInput(): HTMLElement {
  return screen.getByLabelText('Search fields and values')
}

test('renders the raw document, including a nested field no descriptor knows', () => {
  render(<ContentFieldInspector kind="curation" record={curations} />)

  expect(path('_id')).toBeVisible()
  expect(screen.getByText('507f1f77bcf86cd799439011')).toBeVisible()

  fireEvent.click(within(rowOf('unmapped')).getByRole('button', { expanded: false }))
  expect(path('unmapped.inner_code')).toBeVisible()
  expect(screen.getByText('ABC-123')).toBeVisible()
})

test('counts the fields it is showing', () => {
  render(<ContentFieldInspector kind="entity" record={{ name: 'Victoria', population: 85_000, active: true }} />)

  expect(screen.getByText('3 fields')).toBeVisible()
  expect(screen.getByText('85000')).toBeVisible()
})

test('renders scalars readably: booleans as Yes/No and empty values as a dash', () => {
  render(<ContentFieldInspector kind="entity" record={{ is_active: true, is_archived: false, retired_at: null }} />)

  expect(within(rowOf('is_active')).getByText('Yes')).toBeVisible()
  expect(within(rowOf('is_archived')).getByText('No')).toBeVisible()
  expect(within(rowOf('retired_at')).getByText('—')).toBeVisible()
})

test('a search by value keeps the containing subtree and its ancestors', () => {
  render(<ContentFieldInspector kind="curation" record={curations} />)
  expect(screen.queryByText('location.city', { selector: 'code' })).toBeNull()

  fireEvent.change(searchInput(), { target: { value: 'Saanich' } })

  expect(path('location.city')).toBeVisible()
  expect(path('location')).toBeVisible()
  expect(screen.queryByText('title', { selector: 'code' })).toBeNull()
  expect(screen.queryByText('status', { selector: 'code' })).toBeNull()
  expect(screen.getByText('1 field')).toBeVisible()
})

test('collapsing a container hides its children and expanding brings them back', () => {
  render(<ContentFieldInspector kind="curation" record={curations} />)

  const row = rowOf('location')
  fireEvent.click(within(row).getByRole('button', { expanded: false }))
  expect(path('location.city')).toBeVisible()

  fireEvent.click(within(row).getByRole('button', { expanded: true }))
  expect(screen.queryByText('location.city', { selector: 'code' })).toBeNull()
})

test('an unmatched search shows the empty state instead of the tree', () => {
  render(<ContentFieldInspector kind="curation" record={curations} />)
  fireEvent.change(searchInput(), { target: { value: 'nothing-matches-this' } })

  expect(screen.getByText('No fields match the current search.')).toBeVisible()
  expect(screen.getByText('0 fields')).toBeVisible()
})

test('a missing record reports that nothing is loaded', () => {
  render(<ContentFieldInspector kind="curation" record={undefined} />)

  expect(screen.getByRole('status')).toHaveTextContent('No record loaded.')
})

test('marks registry-managed and entity-derived fields as such', () => {
  render(<ContentFieldInspector
    kind="curation"
    record={{ _id: '507f1f77bcf86cd799439011', city: 'Victoria', title: 'Victoria Island' }}
  />)

  const managed = rowOf('_id')
  expect(within(managed).getByText('System-managed')).toBeVisible()
  expect(within(managed).getByText('Read-only')).toBeVisible()

  expect(within(rowOf('city')).getByText('Derived from Entity')).toBeVisible()

  const plain = rowOf('title')
  expect(within(plain).queryByText(/Read-only|System-managed|Derived from/)).toBeNull()
})
