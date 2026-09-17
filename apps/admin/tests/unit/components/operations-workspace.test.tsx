import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { OperationsWorkspace } from '../../../src/components/operations/OperationsWorkspace'
import type { OperationsAdminClient } from '../../../src/operations/admin-client'

const collection = { id: '507f1f77bcf86cd799439011', title: 'Victoria', slug: 'victoria' }

const activeOperation = {
  id: '65f000000000000000000001',
  action: 'add' as const,
  status: 'active' as const,
  parentSummary: { active: 1, completed: 1, failed: 0 },
  progress: { processed: 8, skipped: 0, failed: 0 },
  cancellable: true,
  collections: [collection],
  createdAt: '2026-09-02T10:00:00.000Z',
  updatedAt: '2026-09-02T10:05:00.000Z',
}

const publishJob = {
  id: '65f000000000000000000010',
  collection,
  targetVersion: 3,
  status: 'completed',
  checkpoint: 'promoted',
  selectedCount: 9,
  confirmedUnavailableCount: 1,
  createdAt: '2026-09-02T11:00:00.000Z',
  updatedAt: '2026-09-02T11:02:00.000Z',
}

function client(overrides: Partial<OperationsAdminClient> = {}): OperationsAdminClient {
  return {
    bulkOperations: vi.fn().mockResolvedValue({ items: [activeOperation], nextCursor: null }),
    publishJobs: vi.fn().mockResolvedValue({ items: [publishJob], nextCursor: null }),
    cancelOperation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('renders one queue with per-status counters, semantic statuses and a progress meter', async () => {
  render(<OperationsWorkspace client={client()} pollMs={60_000} />)

  expect(await screen.findByRole('heading', { name: 'Operations' })).toBeVisible()
  expect(screen.getByRole('table', { name: 'Operations' })).toBeVisible()

  // Resumo por estado, derivado das duas leituras — nenhuma requisição extra.
  const summary = screen.getByLabelText('Queue summary by status')
  expect(within(summary).getByText('In progress').parentElement).toHaveTextContent('1')
  expect(within(summary).getByText('completed').parentElement).toHaveTextContent('1')

  // O estado continua legível por `data-status`, que é o contrato das telas.
  expect(screen.getByText('Active').closest('[data-status]')).toHaveAttribute('data-status', 'active')

  // Bulk: 1 de 2 filhos resolvidos; publicação: 1 de 9 confirmados indisponíveis.
  const meters = screen.getAllByRole('progressbar')
  expect(meters).toHaveLength(2)
  expect(meters[0]).toHaveAttribute('aria-valuenow', '1')
  expect(meters[0]).toHaveAttribute('aria-valuemax', '2')
  expect(meters[0]).toHaveAccessibleName('Progress: 8 applied')
  expect(meters[1]).toHaveAccessibleName('Progress: 1 of 9 confirmed unavailable')

  const collectionLinks = screen.getAllByRole('link', { name: 'Victoria' })
  expect(collectionLinks).toHaveLength(2)
  collectionLinks.forEach((link) => expect(link).toHaveAttribute('href', `/admin/collections/collections/${collection.id}`))

  expect(screen.getByText('promoted')).toBeVisible()
  expect(screen.queryByText(/65f000000000000000000010/)).toBeNull()
})

test('opens the operation detail in the kit Drawer from the keyboard', async () => {
  render(<OperationsWorkspace client={client()} pollMs={60_000} />)

  // Fluxo real do teclado: a tabela recebe o foco, a seta ativa a linha e Enter abre.
  await screen.findByText('Add to draft')
  const table = screen.getByRole('table', { name: 'Operations' })
  fireEvent.keyDown(table, { key: 'ArrowDown' })
  fireEvent.keyDown(table, { key: 'Enter' })

  const detail = await screen.findByRole('dialog', { name: 'Add to draft' })
  expect(within(detail).getByText('Draft work')).toBeVisible()
  expect(within(detail).getByText('1 pending, 1 done, 0 failed')).toBeVisible()
  expect(within(detail).getByText('8 applied')).toBeVisible()
  expect(within(detail).getByText(activeOperation.id)).toBeVisible()
  expect(within(detail).getByRole('link', { name: 'Open Collection' })).toHaveAttribute(
    'href',
    `/admin/collections/collections/${collection.id}`,
  )
})

test('cancels only a cancellable active operation and reloads the queue', async () => {
  const cancelOperation = vi.fn().mockResolvedValue(undefined)
  const bulkOperations = vi.fn().mockResolvedValue({ items: [activeOperation], nextCursor: null })
  render(<OperationsWorkspace client={client({ bulkOperations, cancelOperation })} pollMs={60_000} />)

  fireEvent.click(await screen.findByRole('button', { name: 'Cancel operation' }))

  await waitFor(() => expect(cancelOperation).toHaveBeenCalledWith(activeOperation.id))
  await waitFor(() => expect(bulkOperations.mock.calls.length).toBeGreaterThan(1))
})

test('never offers cancel for an operation whose children already started committing', async () => {
  const committed = { ...activeOperation, cancellable: false }
  render(<OperationsWorkspace client={client({
    bulkOperations: vi.fn().mockResolvedValue({ items: [committed], nextCursor: null }),
  })} pollMs={60_000} />)

  expect(await screen.findByText('Add to draft')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Cancel operation' })).toBeNull()
})

test('a failed read keeps the screen alive with ErrorState and a working retry', async () => {
  const bulkOperations = vi.fn()
    .mockRejectedValueOnce(new Error('503 service_unavailable'))
    .mockResolvedValueOnce({ items: [activeOperation], nextCursor: null })
  render(<OperationsWorkspace client={client({ bulkOperations })} pollMs={60_000} />)

  const failure = await screen.findByRole('alert')
  expect(failure).toHaveTextContent('Operations could not load')
  expect(screen.queryByRole('table', { name: 'Operations' })).toBeNull()

  fireEvent.click(within(failure).getByRole('button', { name: 'Try again' }))

  expect(await screen.findByRole('table', { name: 'Operations' })).toBeVisible()
  expect(screen.queryByText('Operations could not load')).toBeNull()
})

test('a failed refresh keeps the loaded queue and offers a retry instead of hiding it', async () => {
  const bulkOperations = vi.fn()
    .mockResolvedValueOnce({ items: [activeOperation], nextCursor: null })
    .mockRejectedValueOnce(new Error('529 overloaded'))
  render(<OperationsWorkspace client={client({ bulkOperations })} pollMs={60_000} />)

  expect(await screen.findByRole('table', { name: 'Operations' })).toBeVisible()
  // A primeira leitura já resolveu; a segunda é o refresh, que não pode apagar a fila.
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

  const notice = await screen.findByRole('alert')
  expect(notice).toHaveTextContent('Unable to refresh Operations: 529 overloaded')
  expect(screen.getByRole('table', { name: 'Operations' })).toBeVisible()
  expect(within(notice).getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('shows the empty state with a way forward when there is no work at all', async () => {
  render(<OperationsWorkspace client={client({
    bulkOperations: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    publishJobs: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  })} pollMs={60_000} />)

  expect(await screen.findByLabelText('No operations yet')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Refresh queue' })).toBeVisible()
})

test('a failed operation points at the Collection instead of inventing a retry endpoint', async () => {
  const failed = { ...activeOperation, status: 'failed' as const, cancellable: false }
  render(<OperationsWorkspace client={client({
    bulkOperations: vi.fn().mockResolvedValue({ items: [failed], nextCursor: null }),
  })} pollMs={60_000} />)

  const retry = await screen.findByRole('link', { name: 'Retry in Collection' })
  expect(retry).toHaveAttribute('href', `/admin/collections/collections/${collection.id}`)
  expect(screen.queryByRole('button', { name: 'Cancel operation' })).toBeNull()

  // O link navega: não pode abrir o detalhe da linha por borbulhamento.
  fireEvent.click(retry)
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('an active operation offers no retry link', async () => {
  render(<OperationsWorkspace client={client()} pollMs={60_000} />)

  expect(await screen.findByText('Add to draft')).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Retry in Collection' })).toBeNull()
})
