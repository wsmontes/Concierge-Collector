import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { EntityTable } from '../../../../src/components/entities/EntityTable'
import type { EntityRow } from '../../../../src/content/record-types'

function rows(count: number): EntityRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `entity-${index + 1}`,
    entity_id: `ent-${index + 1}`,
    name: `Entity ${index + 1}`,
    type: 'restaurant',
    status: 'active',
    city: 'Vancouver',
    updated_at: null,
    version: 1,
    curations_count: index,
    collections_count: index,
  }))
}

function renderTable(items: EntityRow[], onOpenRow = vi.fn()) {
  render(<EntityTable height={600} navigate={vi.fn()} onOpenRow={onOpenRow} rowHeight={48} rows={items} />)
  return onOpenRow
}

afterEach(cleanup)

test('keeps the DOM bounded for a 50k-row result', () => {
  renderTable(rows(50_000))

  expect(screen.getAllByRole('row').length).toBeLessThan(100)
  expect(screen.getByText('Entity 1')).toBeVisible()
})

test('a row click opens the preview without navigating', () => {
  const onOpenRow = renderTable(rows(2))

  fireEvent.click(screen.getByText('Entity 2'))

  expect(onOpenRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'entity-2' }))
})
