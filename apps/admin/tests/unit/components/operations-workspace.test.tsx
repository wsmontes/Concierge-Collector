import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { OperationsWorkspace } from '../../../src/components/operations/OperationsWorkspace'
import type { OperationsAdminClient } from '../../../src/operations/admin-client'

const collection = { id: '507f1f77bcf86cd799439011', title: 'Victoria', slug: 'victoria' }

function client(overrides: Partial<OperationsAdminClient> = {}): OperationsAdminClient {
  return {
    bulkOperations: vi.fn().mockResolvedValue({
      items: [{
        id: '65f000000000000000000001',
        action: 'add',
        status: 'active',
        parentSummary: { active: 1, completed: 1, failed: 0 },
        progress: { processed: 8, skipped: 0, failed: 0 },
        cancellable: true,
        collections: [collection],
        createdAt: '2026-09-02T10:00:00.000Z',
        updatedAt: '2026-09-02T10:05:00.000Z',
      }],
      nextCursor: null,
    }),
    publishJobs: vi.fn().mockResolvedValue({
      items: [{
        id: '65f000000000000000000010',
        collection,
        targetVersion: 3,
        status: 'completed',
        checkpoint: 'promoted',
        selectedCount: 9,
        confirmedUnavailableCount: 1,
        createdAt: '2026-09-02T11:00:00.000Z',
        updatedAt: '2026-09-02T11:02:00.000Z',
      }],
      nextCursor: null,
    }),
    cancelOperation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('renders navigable bulk operations and publication history', async () => {
  render(<OperationsWorkspace client={client()} pollMs={60_000} />)

  expect(await screen.findByRole('heading', { name: 'Operations' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Bulk operations' })).toBeVisible()
  expect(screen.getByText('1 pending, 1 done, 0 failed')).toBeVisible()
  const collectionLinks = screen.getAllByRole('link', { name: 'Victoria' })
  expect(collectionLinks).toHaveLength(2)
  collectionLinks.forEach((link) => expect(link).toHaveAttribute('href', `/admin/collections/${collection.id}`))
  expect(screen.getByRole('heading', { name: 'Publications' })).toBeVisible()
  expect(screen.getByText('Version 3')).toBeVisible()
  expect(screen.getByText('completed · promoted')).toBeVisible()
  expect(screen.queryByText(/65f000000000000000000010/)).toBeNull()
})

test('cancels only a cancellable active bulk operation and reloads history', async () => {
  const cancelOperation = vi.fn().mockResolvedValue(undefined)
  const bulkOperations = vi.fn().mockResolvedValue({
    items: [{
      id: '65f000000000000000000001',
      action: 'remove',
      status: 'active',
      parentSummary: { active: 1, completed: 0, failed: 0 },
      progress: { processed: 0, skipped: 0, failed: 0 },
      cancellable: true,
      collections: [collection],
      createdAt: '2026-09-02T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
    }],
    nextCursor: null,
  })
  render(<OperationsWorkspace client={client({ bulkOperations, cancelOperation })} pollMs={60_000} />)

  fireEvent.click(await screen.findByRole('button', { name: 'Cancel operation' }))

  await waitFor(() => expect(cancelOperation).toHaveBeenCalledWith('65f000000000000000000001'))
  await waitFor(() => expect(bulkOperations.mock.calls.length).toBeGreaterThan(1))
})