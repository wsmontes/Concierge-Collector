import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CollectionDetailWorkspace } from '../../../src/components/collections/CollectionDetailWorkspace'
import {
  CollectionsAdminError,
  type AdminCollectionRecord,
  type CollectionsAdminClient,
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
    publishPreview: vi.fn(),
    publish: vi.fn(),
    restoreVersionAsDraft: vi.fn(),
    members: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    draftDiff: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    versions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    activity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    ...overrides,
  } as CollectionsAdminClient
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('metadata save uses the loaded revision and replaces the displayed server state', async () => {
  const updated = { ...collection, title: 'Victoria 2027', revision: 13 }
  const patchMetadata = vi.fn().mockResolvedValue(updated)
  const api = client({ patchMetadata })
  render(<CollectionDetailWorkspace collectionId={collection.id} client={api} />)

  await screen.findByRole('heading', { name: 'Victoria' })
  fireEvent.click(screen.getByRole('button', { name: 'Edit metadata' }))
  expect(screen.getByRole('dialog', { name: 'Edit Collection metadata' })).toBeVisible()
  expect(screen.getByText('/victoria')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Victoria 2027' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }))

  await waitFor(() => expect(patchMetadata).toHaveBeenCalledWith(
    expect.objectContaining({ id: collection.id, revision: 12 }),
    { title: 'Victoria 2027', description: 'Island favourites' },
  ))
  expect(await screen.findByRole('heading', { name: 'Victoria 2027' })).toBeVisible()
})

test('stale metadata revision reloads the latest Collection instead of applying optimistic state', async () => {
  const changedElsewhere = { ...collection, title: 'Changed elsewhere', revision: 13 }
  const get = vi.fn()
    .mockResolvedValueOnce(collection)
    .mockResolvedValueOnce(changedElsewhere)
  const patchMetadata = vi.fn().mockRejectedValue(new CollectionsAdminError('revision_conflict', 412, false))
  const api = client({ get, patchMetadata })
  render(<CollectionDetailWorkspace collectionId={collection.id} client={api} />)

  await screen.findByRole('heading', { name: 'Victoria' })
  fireEvent.click(screen.getByRole('button', { name: 'Edit metadata' }))
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My stale edit' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }))

  expect(await screen.findByText('Collection changed on the server. The latest state has been reloaded.')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Changed elsewhere' })).toBeVisible()
})

test('archive and restore use explicit in-app confirmation instead of window.confirm', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm')
  const archived = { ...collection, lifecycle: 'archived' as const, revision: 13 }
  const restored = { ...archived, lifecycle: 'published' as const, revision: 14 }
  const archive = vi.fn().mockResolvedValue(archived)
  const restore = vi.fn().mockResolvedValue(restored)
  const api = client({ archive, restore })
  render(<CollectionDetailWorkspace collectionId={collection.id} client={api} />)

  await screen.findByRole('heading', { name: 'Victoria' })
  fireEvent.click(screen.getByRole('button', { name: 'Archive collection' }))
  expect(screen.getByRole('dialog', { name: 'Archive Collection' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }))
  await waitFor(() => expect(archive).toHaveBeenCalledWith(expect.objectContaining({ revision: 12 })))

  fireEvent.click(await screen.findByRole('button', { name: 'Restore collection' }))
  expect(screen.getByRole('dialog', { name: 'Restore Collection' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }))
  await waitFor(() => expect(restore).toHaveBeenCalledWith(expect.objectContaining({ revision: 13 })))

  expect(confirmSpy).not.toHaveBeenCalled()
})
