import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
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

/**
 * The overlay is the kit's `Drawer`. Outside the browser it draws its
 * no-provider fallback (two copies of `@faceless-ui/modal` live in
 * node_modules, so a `ModalProvider` in the test is not the context the kit
 * reads — only Payload's `RootProvider` is), and that fallback owns the overlay
 * gestures: the labelled close control, `Esc` and the backdrop all reach the
 * owner of the open state. That is the contract this suite holds.
 */
function renderDrawer(element: ReactElement) {
  return render(element)
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
    renderDrawer(<CurationPreviewDrawer loadRecord={vi.fn(() => new Promise<CurationRecordResponse>(() => undefined))} onClose={vi.fn()} row={row} />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading Curation…')
    expect(screen.getByRole('heading', { name: 'Ritz Restaurant' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View Entity →' })).toBeNull()
  })

  test('renders the editorial summary of a linked Curation', async () => {
    renderDrawer(<CurationPreviewDrawer loadRecord={vi.fn().mockResolvedValue(response(linkedRecord))} onClose={vi.fn()} row={row} />)

    expect(await screen.findByText('Human Curation')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('São Paulo · restaurant')).toBeInTheDocument()
    expect(screen.getByText('Wagner Montes')).toBeInTheDocument()
    expect(screen.getByText('Ask for the corner table.')).toBeInTheDocument()
    expect(screen.getByText('Italian · Contemporary')).toBeInTheDocument()

    const evidence = screen.getByRole('heading', { name: 'Curation evidence' }).closest('section')
    expect(evidence).toHaveTextContent('2')
    expect(evidence).toHaveTextContent('5')
    expect(evidence).toHaveTextContent('Available')
    expect(screen.getByRole('link', { name: 'Open full Curation' })).toHaveAttribute('href', '/admin/curations/curation-1')
  })

  test('offers the working name and a link affordance for an orphan Curation', async () => {
    renderDrawer(<CurationPreviewDrawer
      loadRecord={vi.fn().mockResolvedValue(response({ curation_id: 'curation-1', restaurant_name: 'Working name only', sources: {} }))}
      onClose={vi.fn()}
      row={row}
    />)

    expect(await screen.findByText('Working name')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Find and link Entity' })).toHaveAttribute('href', '/admin/entities?q=Working%20name%20only')
    expect(screen.queryByRole('link', { name: 'View Entity →' })).toBeNull()
    expect(screen.getByText('Not available')).toBeInTheDocument()
  })

  test('lists collection links in a named dialog whose close gestures all reach the owner', async () => {
    const onClose = vi.fn()
    renderDrawer(<CurationPreviewDrawer
      loadRecord={vi.fn().mockResolvedValue({
        record: linkedRecord,
        collections: [{ collection_id: 'abc123', slug: 'sao-paulo', title: 'São Paulo Business', current_published_version: 3 }],
      })}
      onClose={onClose}
      row={row}
    />)

    const link = await screen.findByRole('link', { name: 'São Paulo Business' })
    expect(link).toHaveAttribute('href', '/admin/collections/collections/abc123')

    // The overlay is a dialog the reader can name, and it carries the record it
    // is previewing — not an unlabelled box over the list.
    const dialog = screen.getByRole('dialog', { name: 'Ritz Restaurant' })
    expect(dialog).toHaveTextContent('v3')

    fireEvent.scroll(document)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    // `Esc` is the shell's gesture, and the owner of the open state has to hear
    // about it — otherwise the list keeps a row selected for a drawer nobody
    // can see.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2))

    // Same for a click on the scrim.
    fireEvent.click(screen.getByRole('presentation'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(3))
  })

  test('renders an explicit error state that reads the record again', async () => {
    const loadRecord = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(response(linkedRecord))
    renderDrawer(<CurationPreviewDrawer loadRecord={loadRecord} onClose={vi.fn()} row={row} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load this Curation.')
    expect(within(alert).getByText('The record could not be read. Nothing was changed.')).toBeInTheDocument()

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('link', { name: 'Open full Curation' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(loadRecord).toHaveBeenCalledTimes(2)
  })

  test('offers Edit only when a caller knows the editor URL', async () => {
    const { unmount } = renderDrawer(<CurationPreviewDrawer loadRecord={vi.fn().mockResolvedValue(response(linkedRecord))} onClose={vi.fn()} row={row} />)
    await screen.findByRole('link', { name: 'Open full Curation' })
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
    unmount()

    renderDrawer(<CurationPreviewDrawer
      editHref="/admin/curations/curation-1?edit=1"
      loadRecord={vi.fn().mockResolvedValue(response(linkedRecord))}
      onClose={vi.fn()}
      row={row}
    />)
    expect(await screen.findByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/admin/curations/curation-1?edit=1')
  })
})
