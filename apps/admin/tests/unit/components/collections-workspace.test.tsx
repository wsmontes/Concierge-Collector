import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CollectionsWorkspace } from '../../../src/components/collections/CollectionsWorkspace'
import type { AdminCollectionRecord, CollectionsAdminClient } from '../../../src/collections/admin-client'

const rows: AdminCollectionRecord[] = [
  {
    id: '111111111111111111111111',
    slug: 'victoria',
    title: 'Victoria',
    description: null,
    lifecycle: 'published',
    currentPublishedVersion: 2,
    draftRevision: 7,
    draftState: 'dirty',
    publishedSelectedCount: 8,
    draftSelectedCount: 9,
    revision: 12,
  },
  {
    id: '222222222222222222222222',
    slug: 'old',
    title: 'Old',
    description: null,
    lifecycle: 'archived',
    currentPublishedVersion: 1,
    draftRevision: 0,
    draftState: 'clean',
    publishedSelectedCount: 4,
    draftSelectedCount: 4,
    revision: 5,
  },
]

function client(overrides: Partial<CollectionsAdminClient> = {}): CollectionsAdminClient {
  return {
    list: vi.fn().mockResolvedValue(rows),
    get: vi.fn(),
    create: vi.fn(),
    patchMetadata: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
    publishPreview: vi.fn(),
    publish: vi.fn(),
    restoreVersionAsDraft: vi.fn(),
    members: vi.fn(),
    draftDiff: vi.fn(),
    versions: vi.fn(),
    activity: vi.fn(),
    ...overrides,
  } as CollectionsAdminClient
}

afterEach(cleanup)

test('lists published and archived Collections with management state', async () => {
  render(<CollectionsWorkspace client={client()} />)

  expect(await screen.findByRole('link', { name: 'Victoria' })).toHaveAttribute(
    'href',
    '/admin/collections/111111111111111111111111',
  )
  expect(screen.getByRole('link', { name: 'Old' })).toBeVisible()
  expect(screen.getByText('dirty')).toBeVisible()
  expect(screen.getByText('Version 2')).toBeVisible()
  expect(screen.getByText('archived')).toBeVisible()
})

test('filters the management list without hiding archived Collections by default', async () => {
  render(<CollectionsWorkspace client={client()} />)
  await screen.findByRole('link', { name: 'Victoria' })

  fireEvent.change(screen.getByLabelText('Filter Collections'), { target: { value: 'old' } })
  expect(screen.queryByRole('link', { name: 'Victoria' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Old' })).toBeVisible()

  fireEvent.change(screen.getByLabelText('Lifecycle'), { target: { value: 'published' } })
  expect(screen.queryByRole('link', { name: 'Old' })).toBeNull()
})

test('creates through the command API and navigates to the detail page', async () => {
  const created: AdminCollectionRecord = {
    ...rows[0],
    id: '333333333333333333333333',
    slug: 'new',
    title: 'New',
    lifecycle: 'draft',
    currentPublishedVersion: null,
    draftRevision: 0,
    draftState: 'clean',
    publishedSelectedCount: 0,
    draftSelectedCount: 0,
    revision: 1,
  }
  const create = vi.fn().mockResolvedValue(created)
  const navigate = vi.fn()
  render(<CollectionsWorkspace client={client({ list: vi.fn().mockResolvedValue([]), create })} navigate={navigate} />)

  fireEvent.click(await screen.findByRole('button', { name: 'New Collection' }))
  expect(screen.getByRole('dialog', { name: 'New Collection' })).toBeVisible()
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New' } })
  fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'new' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create Collection' }))

  await waitFor(() => expect(create).toHaveBeenCalledWith({
    title: 'New',
    slug: 'new',
    description: null,
  }))
  expect(navigate).toHaveBeenCalledWith('/admin/collections/333333333333333333333333')
})
