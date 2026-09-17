import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

test('renders a whole page in full: the window is for pathological pages only', () => {
  renderTable(rows(50))

  expect(screen.getByText('Entity 50')).toBeVisible()
})

test('a row click opens the preview without navigating', () => {
  const onOpenRow = renderTable(rows(2))

  fireEvent.click(screen.getByText('Entity 2'))

  expect(onOpenRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'entity-2' }))
})

test('the arrows move the active row from the table and Enter opens it', () => {
  const onOpenRow = renderTable(rows(3))

  const table = screen.getByRole('table', { name: 'Entities' })
  // O primeiro ArrowDown ativa a primeira linha (o índice ativo começa em -1),
  // o segundo desce, e Enter abre a linha ativa.
  fireEvent.keyDown(table, { key: 'ArrowDown' })
  fireEvent.keyDown(table, { key: 'ArrowDown' })
  expect(screen.getByText('Entity 2').closest('tr')).toHaveAttribute('data-active', 'true')

  fireEvent.keyDown(table, { key: 'End' })
  fireEvent.keyDown(table, { key: 'Enter' })
  expect(onOpenRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'entity-3' }))
})

test('the header carries the mobile card label of every column', () => {
  renderTable(rows(1))

  const headers = screen.getAllByRole('columnheader').map((node) => node.textContent)
  expect(headers).toEqual(['Entity', 'Type', 'City (derived)', 'Status', 'Curations', 'Collections', 'Updated'])
  // O rótulo da coluna é o mesmo que o cartão mostra abaixo de 900px.
  const cells = screen.getAllByRole('cell')
  expect(cells.map((cell) => cell.getAttribute('data-label'))).toEqual(headers)
})

test('an Entity without an image renders no frame at all', () => {
  renderTable([{ ...rows(1)[0], entity_id: null }])

  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByText('Entity 1')).toBeVisible()
})

test('an image that stops resolving takes its frame with it', () => {
  renderTable(rows(1))

  const image = document.querySelector('img')
  if (image === null) throw new Error('no thumbnail rendered')
  fireEvent.error(image)

  expect(document.querySelector('img')).toBeNull()
  expect(screen.getByText('Entity 1')).toBeVisible()
})

test('the loading surface is a skeleton inside the table, not a text-only wait', () => {
  render(<EntityTable height={600} loading navigate={vi.fn()} onOpenRow={vi.fn()} rowHeight={48} rows={[]} />)

  expect(screen.getByRole('table', { name: 'Entities' })).toBeVisible()
  expect(document.querySelectorAll('.ui-skeleton').length).toBeGreaterThan(0)
  expect(document.querySelector('.ui-table__footer')).toBeNull()
})

test('an empty page renders the empty surface the caller handed in', () => {
  render(
    <EntityTable
      empty={<p>No Entities yet</p>}
      height={600}
      loading={false}
      navigate={vi.fn()}
      onOpenRow={vi.fn()}
      rowHeight={48}
      rows={[]}
    />,
  )

  expect(screen.getByText('No Entities yet')).toBeVisible()
})

test('the footer lives inside the table, next to the count', () => {
  render(
    <EntityTable
      footer={<button type="button">Next page</button>}
      height={600}
      navigate={vi.fn()}
      onOpenRow={vi.fn()}
      rowHeight={48}
      rows={rows(2)}
    />,
  )

  const table = screen.getByRole('table', { name: 'Entities' })
  expect(within(table.closest('.ui-table') as HTMLElement).getByRole('button', { name: 'Next page' })).toBeVisible()
})
