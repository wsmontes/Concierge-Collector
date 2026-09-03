import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CollectionViews } from '../../../src/components/collections/CollectionViews'
import { CurationExplorer } from '../../../src/components/explorer/CurationExplorer'
import { BulkActionDialog } from '../../../src/components/operations/BulkActionDialog'

const collectionId = '507f1f77bcf86cd799439011'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('Collection detail links into Explorer with the Collection target encoded', () => {
  render(<CollectionViews collection={{
    id: collectionId,
    title: 'Victoria',
    lifecycle: 'published',
    draftState: 'dirty',
    currentPublishedVersion: 2,
    draftRevision: 7,
    revision: 12,
    publishedSelectedCount: 8,
    draftSelectedCount: 9,
  }} />)

  expect(screen.getByRole('link', { name: 'Add Curations' })).toHaveAttribute(
    'href',
    `/admin/explorer?collection=${collectionId}`,
  )
})

test('Explorer exposes a safe target context and a way back to the Collection', async () => {
  render(<CurationExplorer
    targetCollectionId={collectionId}
    loadPage={vi.fn().mockResolvedValue({ items: [], next_cursor: null, total: 0 })}
  />)

  expect(await screen.findByText('Selecting Curations for a Collection draft.')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Back to Collection' })).toHaveAttribute(
    'href',
    `/admin/collections/${collectionId}`,
  )
})

test('Bulk dialog preselects an eligible target Collection loaded from the server', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    items: [{
      id: collectionId,
      slug: 'victoria',
      title: 'Victoria',
      lifecycle: 'published',
      draftRevision: 7,
      draftState: 'dirty',
      draftSelectedCount: 9,
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })))

  render(<BulkActionDialog
    initialCollectionId={collectionId}
    selectionId={'1'.repeat(24)}
    onClose={() => undefined}
    onPosted={() => undefined}
  />)

  const checkbox = await screen.findByRole('checkbox', { name: /Victoria/ })
  await waitFor(() => expect(checkbox).toBeChecked())
  expect(screen.queryByRole('alert')).toBeNull()
})

test('Bulk dialog refuses an archived target instead of trusting the query string', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    items: [{
      id: collectionId,
      slug: 'victoria',
      title: 'Victoria',
      lifecycle: 'archived',
      draftRevision: 7,
      draftState: 'clean',
      draftSelectedCount: 9,
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })))

  render(<BulkActionDialog
    initialCollectionId={collectionId}
    selectionId={'1'.repeat(24)}
    onClose={() => undefined}
    onPosted={() => undefined}
  />)

  expect(await screen.findByRole('alert')).toHaveTextContent('The target Collection is not currently editable.')
  expect(screen.getByRole('checkbox', { name: /Victoria/ })).not.toBeChecked()
})
