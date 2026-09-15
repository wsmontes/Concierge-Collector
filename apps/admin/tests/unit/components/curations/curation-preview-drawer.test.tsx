import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CurationPreviewDrawer } from '../../../../src/components/curations/CurationPreviewDrawer'
import type { CurationRecordResponse } from '../../../../src/content/record-types'
import { makeRows } from '../../../support/factories'

const row = makeRows(1, {
  curation_id: 'curation-1',
  restaurant_name: 'Ritz Restaurant',
  updated_at: '2026-09-11T10:00:00.000Z',
})[0]

function response(record: Record<string, unknown>): CurationRecordResponse {
  return { record, collections: [] }
}

const linkedRecord: Record<string, unknown> = {
  curation_id: 'curation-1',
  restaurant_name: 'Ritz Restaurant',
  entity_id: '507f1f77bcf86cd799439011',
  status: 'active',
  curator_type: 'human',
  city: 'São Paulo',
  type: 'restaurant',
  curator: { name: 'Wagner Montes' },
  notes: { public: 'Ask for the corner table.' },
  categories: { Cuisine: ['Italian', 'Contemporary'], Mood: ['Casual'] },
  sources: { audio: [{}, {}], image: [{}, {}, {}, {}, {}] },
  transcript: 'We loved it.',
  updatedAt: '2026-09-11T10:00:00.000Z',
}

describe('CurationPreviewDrawer', () => {
  afterEach(cleanup)

  test('shows a loading state until the record arrives', () => {
    render(<CurationPreviewDrawer loadRecord={vi.fn(() => new Promise<CurationRecordResponse>(() => undefined))} onClose={vi.fn()} row={row} />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading Curation…')
    expect(screen.getByRole('heading', { name: 'Ritz Restaurant' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View Entity →' })).toBeNull()
  })

  test('renders the editorial summary of a linked Curation', async () => {
    render(<CurationPreviewDrawer loadRecord={vi.fn().mockResolvedValue(response(linkedRecord))} onClose={vi.fn()} row={row} />)

    expect(await screen.findByText('Human Curation')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('São Paulo · restaurant')).toBeInTheDocument()
    expect(screen.getByText('Wagner Montes')).toBeInTheDocument()
    expect(screen.getByText('Ask for the corner table.')).toBeInTheDocument()
    expect(screen.getByText('Italian · Contemporary')).toBeInTheDocument()

    const sources = screen.getByRole('heading', { name: 'Sources' }).closest('section')
    expect(sources).toHaveTextContent('2')
    expect(sources).toHaveTextContent('5')
    expect(sources).toHaveTextContent('Available')
    expect(screen.getByRole('link', { name: 'Open full Curation' })).toHaveAttribute('href', '/admin/curations/curation-1')
  })

  test('offers the working name and a link affordance for an orphan Curation', async () => {
    render(<CurationPreviewDrawer
      loadRecord={vi.fn().mockResolvedValue(response({ curation_id: 'curation-1', restaurant_name: 'Working name only', sources: {} }))}
      onClose={vi.fn()}
      row={row}
    />)

    expect(await screen.findByText('Working name')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Find and link Entity' })).toHaveAttribute('href', '/admin/entities?q=Working%20name%20only')
    expect(screen.queryByRole('link', { name: 'View Entity →' })).toBeNull()
    expect(screen.getByText('Not available')).toBeInTheDocument()
  })

  test('lists collection links and only an explicit close closes the drawer', async () => {
    const onClose = vi.fn()
    render(<CurationPreviewDrawer
      loadRecord={vi.fn().mockResolvedValue({
        record: linkedRecord,
        collections: [{ collection_id: 'abc123', slug: 'sao-paulo', title: 'São Paulo Business', current_published_version: 3 }],
      })}
      onClose={onClose}
      row={row}
    />)

    const link = await screen.findByRole('link', { name: 'São Paulo Business' })
    expect(link).toHaveAttribute('href', '/admin/collections/collections/abc123')
    expect(screen.getByRole('dialog')).toHaveTextContent('v3')

    fireEvent.scroll(document)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('renders an explicit error state when the loader rejects', async () => {
    render(<CurationPreviewDrawer loadRecord={vi.fn().mockRejectedValue(new Error('boom'))} onClose={vi.fn()} row={row} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load this Curation. Try again.')
  })

  test('offers Edit only when a caller knows the editor URL', async () => {
    const { unmount } = render(<CurationPreviewDrawer loadRecord={vi.fn().mockResolvedValue(response(linkedRecord))} onClose={vi.fn()} row={row} />)
    await screen.findByRole('link', { name: 'Open full Curation' })
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
    unmount()

    render(<CurationPreviewDrawer
      editHref="/admin/curations/curation-1?edit=1"
      loadRecord={vi.fn().mockResolvedValue(response(linkedRecord))}
      onClose={vi.fn()}
      row={row}
    />)
    expect(await screen.findByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/admin/curations/curation-1?edit=1')
  })
})
