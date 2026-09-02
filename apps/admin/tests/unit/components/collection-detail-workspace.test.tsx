import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CollectionDetailWorkspace } from '../../../src/components/collections/CollectionDetailWorkspace'
import type {
  AdminCollectionRecord,
  CollectionsAdminClient,
  MemberRowDto,
} from '../../../src/collections/admin-client'

const collection: AdminCollectionRecord = {
  id: '507f1f77bcf86cd799439011',
  slug: 'victoria',
  title: 'Victoria',
  description: 'Island favourites',
  lifecycle: 'published',
  currentPublishedVersion: 2,
  draftRevision: 7,
  draftState: 'dirty',
  publishedSelectedCount: 8,
  draftSelectedCount: 9,
  revision: 12,
}

function client(overrides: Partial<CollectionsAdminClient> = {}): CollectionsAdminClient {
  return {
    list: vi.fn(),
    get: vi.fn().mockResolvedValue(collection),
    create: vi.fn(),
    patchMetadata: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
    publish: vi.fn(),
    restoreVersionAsDraft: vi.fn(),
    members: vi.fn().mockResolvedValue({ items: [{ curationId: 'c1' }], nextCursor: 'm2' }),
    draftDiff: vi.fn().mockResolvedValue({
      items: [{ curationId: 'c2', desiredState: 'add', operationId: 'op1' }],
      nextCursor: null,
    }),
    versions: vi.fn().mockResolvedValue({
      items: [{ version: 2, selectedCount: 8, membershipHash: 'a'.repeat(64) }],
      nextCursor: null,
    }),
    activity: vi.fn().mockResolvedValue({
      items: [{ eventType: 'collection.published', actorId: 'admin-1', createdAt: '2026-09-01T12:00:00Z' }],
      nextCursor: null,
    }),
    ...overrides,
  } as CollectionsAdminClient
}

afterEach(cleanup)

test('loads Collection and tab previews from the live cursor endpoints', async () => {
  const api = client()
  render(<CollectionDetailWorkspace collectionId={collection.id} client={api} />)

  expect(await screen.findByRole('heading', { name: 'Victoria' })).toBeVisible()
  await waitFor(() => {
    expect(api.members).toHaveBeenCalledWith(collection.id, 2, undefined)
    expect(api.draftDiff).toHaveBeenCalledWith(collection.id, undefined)
    expect(api.versions).toHaveBeenCalledWith(collection.id, undefined)
    expect(api.activity).toHaveBeenCalledWith(collection.id, undefined)
  })

  fireEvent.click(screen.getByRole('tab', { name: 'Draft Changes' }))
  expect(screen.getByText('c2')).toBeVisible()
  fireEvent.click(screen.getByRole('tab', { name: 'Versions' }))
  expect(screen.getByText('Version 2')).toBeVisible()
  fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
  expect(screen.getByText(/collection\.published/)).toBeVisible()
})

test('appends the next members page instead of replacing the first page', async () => {
  const first: MemberRowDto[] = [{ curationId: 'c1' }]
  const second: MemberRowDto[] = [{ curationId: 'c2' }]
  const members = vi.fn()
    .mockResolvedValueOnce({ items: first, nextCursor: 'm2' })
    .mockResolvedValueOnce({ items: second, nextCursor: null })
  const api = client({ members })

  render(<CollectionDetailWorkspace collectionId={collection.id} client={api} />)
  await screen.findByRole('heading', { name: 'Victoria' })
  fireEvent.click(screen.getByRole('tab', { name: 'Members' }))
  expect(await screen.findByText('c1')).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Load more members' }))

  expect(await screen.findByText('c2')).toBeVisible()
  expect(screen.getByText('c1')).toBeVisible()
  expect(members).toHaveBeenNthCalledWith(2, collection.id, 2, 'm2')
})
