import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MembersView } from '../../../src/components/collections/MembersView'
import type { CurationRecordResponse } from '../../../src/content/record-types'
import { makeRows } from '../../support/factories'

/** §24: a Collection member is an editorial row, not an id. */

const COLLECTION_ID = '507f1f77bcf86cd799439011'

const ritz = makeRows(1, {
  curation_id: 'cur_1',
  restaurant_name: 'Ritz Restaurant',
  curator_name: 'Wagner Montes',
  entity_type: 'Restaurant',
  city: 'São Paulo',
  concepts: ['Business', 'Casual'],
  status: 'active',
  updated_at: '2026-09-11T10:00:00.000Z',
  version: 4,
})[0]

function recordResponse(): CurationRecordResponse {
  return {
    record: { curation_id: 'cur_1', restaurant_name: 'Ritz Restaurant', status: 'active' },
    collections: [],
  }
}

afterEach(cleanup)

describe('MembersView', () => {
  test('renders the human identity and keeps the raw id inside a collapsed disclosure', () => {
    const { container } = render(<MembersView items={[{ curationId: 'cur_1', summary: ritz }]} />)

    expect(screen.getByText('Ritz Restaurant')).toBeVisible()
    expect(screen.getByText('Wagner Montes')).toBeVisible()
    expect(screen.getByText('Restaurant · São Paulo')).toBeVisible()
    expect(screen.getByText('Business')).toBeVisible()
    expect(screen.getByText('Casual')).toBeVisible()
    const status = container.querySelector('.collection-members__facts [data-status]')
    expect(status).toHaveAttribute('data-status', 'active')
    expect(status).toHaveTextContent('Active')

    // The id never reads as the row's identity…
    const name = container.querySelector('.collection-curation__name')
    expect(name?.textContent).toBe('Ritz Restaurant')
    // …it lives behind the per-row disclosure, which starts closed.
    const details = container.querySelector('details')
    expect(details?.open).toBe(false)
    expect(within(details as HTMLElement).getByText('cur_1')).toBeTruthy()

    const updated = container.querySelector('.collection-members__updated')
    expect(updated?.textContent).toContain('Updated')
    expect(updated?.textContent).not.toContain('unknown')
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/admin/curations/cur_1')
  })

  test('degrades a member with no catalog row to its id and an explicit note', () => {
    render(<MembersView items={[{ curationId: 'cur_gone', summary: null }]} />)

    expect(screen.getByText('No longer in the catalog')).toBeVisible()
    expect(screen.getByText('cur_gone')).toBeVisible()
    // Nothing is invented for a row the catalog dropped: no name, no preview.
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/admin/curations/cur_gone')
    expect(screen.getByText('unknown')).toBeVisible()
  })

  test('opens the shared preview for a member and keeps the way back to the Collection', async () => {
    const loadRecord = vi.fn().mockResolvedValue(recordResponse())
    render(
      <MembersView
        collectionId={COLLECTION_ID}
        items={[{ curationId: 'cur_1', summary: ritz }]}
        loadRecord={loadRecord}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    expect(await screen.findByRole('link', { name: 'Open full Curation' }))
      .toHaveAttribute('href', '/admin/curations/cur_1')
    expect(screen.getByRole('link', { name: 'Back to Collection' }))
      .toHaveAttribute('href', `/admin/collections/collections/${COLLECTION_ID}`)
    expect(loadRecord).toHaveBeenCalledWith('cur_1')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Ritz Restaurant')).toBeVisible()
  })

  test('keeps the cursor pagination control of the members read', () => {
    const onLoadMore = vi.fn()
    render(
      <MembersView
        hasMore
        items={[{ curationId: 'cur_1', summary: ritz }]}
        onLoadMore={onLoadMore}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more members' }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
})
