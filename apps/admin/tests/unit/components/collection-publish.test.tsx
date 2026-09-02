import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CollectionDetailWorkspace } from '../../../src/components/collections/CollectionDetailWorkspace'
import type {
  AdminCollectionRecord,
  CollectionsAdminClient,
  PublishPreviewDto,
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

const preview: PublishPreviewDto = {
  currentPublishedVersion: 2,
  nextVersion: 3,
  draftRevision: 7,
  revision: 12,
  selectedCount: 9,
  availableCount: 8,
  unavailableCount: 1,
}

function client(overrides: Partial<CollectionsAdminClient> = {}): CollectionsAdminClient {
  return {
    list: vi.fn(),
    get: vi.fn().mockResolvedValue(collection),
    create: vi.fn(),
    patchMetadata: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
    publishPreview: vi.fn().mockResolvedValue(preview),
    publish: vi.fn().mockResolvedValue({ id: 'job-1', status: 'queued' }),
    restoreVersionAsDraft: vi.fn(),
    members: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    draftDiff: vi.fn().mockResolvedValue({
      items: [
        { curationId: 'c-add', desiredState: 'add', operationId: 'op-1' },
        { curationId: 'c-remove', desiredState: 'remove', operationId: 'op-2' },
      ],
      nextCursor: null,
    }),
    versions: vi.fn().mockResolvedValue({
      items: [
        { version: 2, selectedCount: 8, membershipHash: 'b'.repeat(64) },
        { version: 1, selectedCount: 6, membershipHash: 'a'.repeat(64) },
      ],
      nextCursor: null,
    }),
    activity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    ...overrides,
  } as CollectionsAdminClient
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('publish preview shows exact live counts and requires unavailable confirmation', async () => {
  const api = client()
  render(<CollectionDetailWorkspace collectionId={collection.id} client={api} />)

  await screen.findByRole('heading', { name: 'Victoria' })
  fireEvent.click(screen.getByRole('button', { name: 'Publish new version' }))

  expect(await screen.findByRole('dialog', { name: 'Publish Collection' })).toBeVisible()
  expect(api.publishPreview).toHaveBeenCalledWith(collection.id)
  expect(screen.getByText('Version 2 → Version 3')).toBeVisible()
  expect(screen.getByText('9 selected')).toBeVisible()
  expect(screen.getByText('8 available')).toBeVisible()
  expect(screen.getByText('1 unavailable')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Publish Collection now' })).toBeDisabled()

  fireEvent.click(screen.getByRole('checkbox', { name: 'Publish with 1 unavailable Curation' }))
  expect(screen.getByRole('button', { name: 'Publish Collection now' })).toBeEnabled()
})

test('confirmed publish uses the preview count and refreshes after promotion', async () => {
  const promoted: AdminCollectionRecord = {
    ...collection,
    currentPublishedVersion: 3,
    draftRevision: 0,
    draftState: 'clean',
    publishedSelectedCount: 9,
    draftSelectedCount: 9,
    revision: 14,
  }
  const get = vi.fn()
    .mockResolvedValueOnce(collection)
    .mockResolvedValueOnce(promoted)
  const publish = vi.fn().mockResolvedValue({ id: 'job-1', status: 'queued' })
  const versions = vi.fn()
    .mockResolvedValueOnce({
      items: [
        { version: 2, selectedCount: 8, membershipHash: 'b'.repeat(64) },
        { version: 1, selectedCount: 6, membershipHash: 'a'.repeat(64) },
      ],
      nextCursor: null,
    })
    .mockResolvedValueOnce({
      items: [
        { version: 3, selectedCount: 9, membershipHash: 'c'.repeat(64) },
        { version: 2, selectedCount: 8, membershipHash: 'b'.repeat(64) },
      ],
      nextCursor: null,
    })
  const api = client({ get, publish, versions })
  render(<CollectionDetailWorkspace collectionId={collection.id} client={api} />)

  await screen.findByRole('heading', { name: 'Victoria' })
  fireEvent.click(screen.getByRole('button', { name: 'Publish new version' }))
  await screen.findByRole('dialog', { name: 'Publish Collection' })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Publish with 1 unavailable Curation' }))
  fireEvent.click(screen.getByRole('button', { name: 'Publish Collection now' }))

  await waitFor(() => expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({ id: collection.id, revision: 12 }),
    { confirmUnavailable: true, expectedUnavailableCount: 1 },
  ))
  expect(await screen.findByText('Published version 3.')).toBeVisible()

  fireEvent.click(screen.getByRole('tab', { name: 'Versions' }))
  expect(screen.getByText('Version 3')).toBeVisible()
})

test('restore as draft queues historical deltas without changing the published version', async () => {
  const restoreVersionAsDraft = vi.fn().mockResolvedValue({
    collectionId: collection.id,
    restoredVersion: 1,
    baseVersion: 2,
    addedCount: 2,
    removedCount: 1,
    operationIds: ['op-restore-1'],
  })
  const api = client({ restoreVersionAsDraft })
  render(<CollectionDetailWorkspace collectionId={collection.id} client={api} />)

  await screen.findByRole('heading', { name: 'Victoria' })
  fireEvent.click(screen.getByRole('tab', { name: 'Versions' }))
  fireEvent.click(screen.getByRole('button', { name: 'Restore version 1 as draft' }))

  expect(screen.getByRole('dialog', { name: 'Restore version 1 as draft' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restore as draft' }))

  await waitFor(() => expect(restoreVersionAsDraft).toHaveBeenCalledWith(collection.id, 1))
  expect(await screen.findByText('Version 1 queued as draft changes: 2 adds, 1 remove.')).toBeVisible()
  expect(screen.getByText('Published version 2')).toBeVisible()
})
