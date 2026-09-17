import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CurationDetailWorkspace } from '../../../../src/components/curations/CurationDetailWorkspace'
import type { CurationCollectionLink, LoadCurationRecord, SaveCurationRecord } from '../../../../src/content/record-types'

/**
 * Every assertion below is about what an editor can see and click: the sections
 * a fixture record produces, the exact PATCH body an edit sends, and what the
 * page does when the server refuses the write.
 */

const CURATION_ID = 'cur_01HE90A'

const record: Record<string, unknown> = {
  curation_id: CURATION_ID,
  entity_id: 'ent_ritz',
  entity_name: 'Ritz Restaurant',
  restaurant_name: 'Ritz',
  status: 'active',
  curator_id: 'curator_1',
  curator: { name: 'Wagner Montes', email: 'wagner@example.com' },
  curator_type: 'human',
  city: 'São Paulo',
  type: 'restaurant',
  notes: { public: 'Excellent option for...', private: 'Ask for the corner table' },
  categories: {
    Cuisine: ['Italian', 'Contemporary'],
    Mood: ['Casual', 'Lively'],
    'Price Range': ['$$$'],
  },
  transcript: 'Review 1: the pasta is excellent.',
  sources: {
    image: [{
      source_id: 'img_1',
      type: 'photo_capture',
      filename: 'front-room.jpg',
      width: 1200,
      height: 800,
      status: 'processed',
    }],
    audio: [{
      source_id: 'aud_1',
      type: 'voice_transcript',
      duration_seconds: 222,
      transcript: 'The pasta is excellent and the room is quiet.',
      transcription_model: 'whisper-1',
    }],
    google_places: [{ place_id: 'gp_1', rating: 4.8 }],
  },
  items: [{ name: 'Cacio e pepe' }],
  // A key no version of the registry describes.
  price_level: '$$',
  version: 7,
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-13T12:00:00.000Z',
  createdBy: 'curator_1',
  updatedBy: 'curator_1',
}

const collections: CurationCollectionLink[] = [
  { collection_id: 'col_1', slug: 'best-business-lunches', title: 'Best Business Lunches', current_published_version: 3 },
]

function conflictFailure(): Error {
  const failure = new Error('conflict') as Error & { status: number; code: string }
  failure.status = 409
  failure.code = 'conflict'
  return failure
}

function setup(overrides: {
  loadRecord?: LoadCurationRecord
  saveRecord?: SaveCurationRecord
} = {}) {
  const loadRecord = overrides.loadRecord ?? vi.fn().mockResolvedValue({ record, collections })
  const saveRecord = overrides.saveRecord ?? vi.fn().mockResolvedValue({ record })
  const navigate = vi.fn()
  render(
    <CurationDetailWorkspace
      curationId={CURATION_ID}
      loadRecord={loadRecord}
      saveRecord={saveRecord}
      navigate={navigate}
    />,
  )
  return { loadRecord, saveRecord, navigate }
}

/** The page's own block for a path — not the Inspector's row for it. */
function pathBlock(path: string): HTMLElement {
  const block = document.querySelector<HTMLElement>(`.ui-field-block[data-path="${path}"]`)
  if (block === null) throw new Error(`No field block rendered for "${path}"`)
  return block
}

function inspectorRow(path: string): HTMLElement {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.content-inspector__row'))
  const row = rows.find((candidate) => candidate.querySelector('.content-field__path')?.textContent === path)
  if (row === undefined) throw new Error(`No Inspector row rendered for "${path}"`)
  return row
}

function headerRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'Curation record' })
}

afterEach(cleanup)

describe('CurationDetailWorkspace', () => {
  test('renders every section of the plan structure from the record', async () => {
    setup()
    expect(await screen.findByRole('heading', { level: 1, name: 'Ritz' })).toBeVisible()
    for (const section of [
      'About',
      'Your curation',
      'Concepts',
      'Curation evidence',
      'Collections',
      'History',
      'All fields',
      'Advanced',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeVisible()
    }
  })

  test('header names the curator kind, status, link state, version and list back-link', async () => {
    setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })
    const header = headerRegion()

    expect(screen.getByText('Human curation · active')).toBeVisible()
    expect(within(header).getByText('Active')).toBeVisible()
    expect(within(header).getByRole('link', { name: 'Ritz Restaurant' }))
      .toHaveAttribute('href', '/admin/entities/ent_ritz')
    expect(within(header).getByText('Wagner Montes · Human')).toBeVisible()
    expect(within(header).getByText('7')).toBeVisible()
    expect(within(header).getByText(CURATION_ID)).toBeVisible()
    expect(screen.getByRole('link', { name: '← All Curations' })).toHaveAttribute('href', '/admin/curations')
  })

  test('an unlinked Curation offers the working name and a way to find an Entity', async () => {
    const unlinked = {
      curation_id: CURATION_ID,
      entity_id: null,
      restaurant_name: 'Quiet corner place',
      status: 'draft',
      curator_type: 'synthetic',
      notes: { public: 'Needs an Entity.' },
      version: 2,
    }
    setup({ loadRecord: vi.fn().mockResolvedValue({ record: unlinked, collections: [] }) })

    expect(await screen.findByRole('heading', { level: 1, name: 'Quiet corner place' })).toBeVisible()
    expect(screen.getByText('Synthetic curation · draft')).toBeVisible()
    expect(screen.getByText('No Entity linked')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Find and link Entity' })).toHaveAttribute('href', '/admin/entities')
    // The working name is the Curation's own editable field when nothing is linked.
    const block = pathBlock('restaurant_name')
    expect(within(block).getByRole('button', { name: 'Edit' })).toBeEnabled()
  })

  test('an Entity id alone is secondary text, never the page title', async () => {
    const idOnly = { curation_id: CURATION_ID, entity_id: 'ent_ritz', status: 'linked', version: 2 }
    setup({ loadRecord: vi.fn().mockResolvedValue({ record: idOnly, collections: [] }) })

    expect(await screen.findByRole('heading', { level: 1, name: 'Untitled Curation' })).toBeVisible()
    expect(screen.getByText('Entity id ent_ritz')).toBeVisible()
    const about = screen.getByRole('heading', { level: 2, name: 'About' }).closest('section') as HTMLElement
    expect(within(about).getByRole('link', { name: 'View Entity →' }))
      .toHaveAttribute('href', '/admin/entities/ent_ritz')
  })

  test('shows a loading surface until the record resolves', () => {
    const pending = Promise.withResolvers<never>()
    setup({ loadRecord: vi.fn(() => pending.promise) })
    expect(screen.getByRole('status')).toHaveTextContent('Loading Curation…')
  })

  test('a 404 load renders the not-found surface instead of an empty record', async () => {
    setup({ loadRecord: vi.fn().mockRejectedValue({ status: 404, code: 'not_found' }) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Curation not found' })).toBeVisible()
    expect(screen.getByText(`No Curation is stored for ${CURATION_ID}.`)).toBeVisible()
    expect(screen.getByText('Nothing to show')).toBeVisible()
  })

  test('a failing load keeps the page recoverable', async () => {
    const loadRecord = vi.fn()
      .mockRejectedValueOnce({ status: 503, code: 'service_unavailable' })
      .mockResolvedValue({ record, collections })
    setup({ loadRecord })

    expect(await screen.findByRole('heading', { level: 1, name: 'Curation unavailable' })).toBeVisible()
    // The failure says which failure it was, and offers the read again.
    expect(screen.getByRole('alert')).toHaveTextContent('The Curations service is unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Ritz' })).toBeVisible()
  })

  test('renders city as Entity-derived with a link and no text input', async () => {
    setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const derived = screen.getByRole('heading', { level: 3, name: 'City' }).closest('.ui-derived')
    expect(derived).not.toBeNull()
    const panel = derived as HTMLElement
    expect(within(panel).getByText('São Paulo')).toBeVisible()
    expect(within(panel).getByText('Derived from Entity')).toBeVisible()
    expect(within(panel).getByRole('link', { name: 'Edit Entity →' })).toHaveAttribute('href', '/admin/entities/ent_ritz')
    expect(within(panel).queryByRole('textbox')).toBeNull()
  })

  test('editing a block PATCHes the edited top-level key with the loaded version', async () => {
    const { saveRecord } = setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const block = pathBlock('notes.public')
    fireEvent.click(within(block).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(block).getByLabelText('Public recommendation'), {
      target: { value: 'Superb pasta, quiet room.' },
    })
    fireEvent.click(within(block).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(saveRecord).toHaveBeenCalledWith({
        curationId: CURATION_ID,
        updates: { notes: { public: 'Superb pasta, quiet room.', private: 'Ask for the corner table' } },
        expectedVersion: 7,
      })
    })
    expect(saveRecord).toHaveBeenCalledTimes(1)
  })

  test('Escape abandons an open block edit without saving', async () => {
    const { saveRecord } = setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const block = pathBlock('notes.public')
    fireEvent.click(within(block).getByRole('button', { name: 'Edit' }))
    fireEvent.keyDown(within(block).getByLabelText('Public recommendation'), { key: 'Escape' })

    expect(saveRecord).not.toHaveBeenCalled()
    await waitFor(() => expect(within(block).getByText('Excellent option for...')).toBeVisible())
  })

  test('a 409 keeps the draft, shows the conflict and never overwrites the stored value', async () => {
    const saveRecord = vi.fn().mockRejectedValue(conflictFailure())
    const { loadRecord } = setup({ saveRecord })
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const block = pathBlock('notes.public')
    fireEvent.click(within(block).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(block).getByLabelText('Public recommendation'), { target: { value: 'My draft text' } })
    fireEvent.click(within(block).getByRole('button', { name: 'Save' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('This Curation changed while you were editing it.')).toBeVisible()
    expect(within(alert).getByText('My draft text')).toBeVisible()
    expect(within(alert).getByText('Excellent option for...')).toBeVisible()
    // The editor is still open, holding the draft the server refused.
    expect(within(block).getByLabelText('Public recommendation')).toHaveValue('My draft text')

    fireEvent.click(within(alert).getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(loadRecord).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('This Curation changed while you were editing it.')).toBeNull())
    expect(within(block).getByText('Excellent option for...')).toBeVisible()
  })

  test('renders concepts grouped by their stored category with an encoded deep link', async () => {
    setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    expect(screen.getByRole('heading', { level: 3, name: 'Cuisine' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 3, name: 'Mood' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 3, name: 'Price Range' })).toBeVisible()
    // Nothing is hardcoded: a category the record does not store is not invented.
    expect(screen.queryByRole('heading', { level: 3, name: 'Food Style' })).toBeNull()
    expect(screen.getByRole('link', { name: 'View curations with Mood = Casual' }))
      .toHaveAttribute('href', '/admin/curations?concept.Mood=Casual')
    expect(screen.getByRole('link', { name: 'View curations with Price Range = $$$' }))
      .toHaveAttribute('href', '/admin/curations?concept.Price%20Range=%24%24%24')
  })

  test('adding and removing a concept value PATCHes the whole categories key', async () => {
    const { saveRecord } = setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const concepts = screen.getByRole('heading', { level: 2, name: 'Concepts' }).closest('section') as HTMLElement
    fireEvent.click(within(concepts).getByRole('button', { name: 'Edit Concepts' }))
    fireEvent.change(within(concepts).getByLabelText('Mood value 1'), { target: { value: 'Quiet' } })
    fireEvent.click(within(concepts).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(saveRecord).toHaveBeenCalledWith({
        curationId: CURATION_ID,
        updates: {
          categories: {
            Cuisine: ['Italian', 'Contemporary'],
            Mood: ['Quiet', 'Lively'],
            'Price Range': ['$$$'],
          },
        },
        expectedVersion: 7,
      })
    })
  })

  test('renders media provenance, transcript and other sources from the stored objects', async () => {
    setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const images = screen.getByRole('region', { name: 'Captured images' })
    expect(within(images).getByText('1 stored')).toBeVisible()
    // The filename is both the entry title and a stored metadata row.
    expect(within(images).getAllByText('front-room.jpg').length).toBeGreaterThan(0)
    expect(within(images).getByText('1200')).toBeVisible()
    expect(within(images).getByText('800')).toBeVisible()

    const audio = screen.getByRole('region', { name: 'Captured audio' })
    expect(within(audio).getByText('Duration 03:42')).toBeVisible()
    expect(within(audio).getByText('Transcription available')).toBeVisible()

    const other = screen.getByRole('region', { name: 'Other evidence' })
    expect(within(other).getByRole('heading', { level: 4, name: 'Google places' })).toBeVisible()

    const transcript = pathBlock('transcript')
    expect(within(transcript).getByText('Review 1: the pasta is excellent.')).toBeVisible()
    expect(screen.getByText('A transcript is stored for this Curation.')).toBeVisible()
  })

  test('renders Collection links on the duplicated-slug detail route', async () => {
    setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    expect(screen.getByRole('link', { name: 'Best Business Lunches' }))
      .toHaveAttribute('href', '/admin/collections/collections/col_1')
    expect(screen.getByText('Published version 3')).toBeVisible()
  })

  test('shows an explicit empty state when the Curation is in no Collection', async () => {
    setup({ loadRecord: vi.fn().mockResolvedValue({ record, collections: [] }) })
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })
    expect(screen.getByText('Not in any Collection')).toBeVisible()
  })

  test('history names the authorship it has and declines to invent a version comparison', async () => {
    setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const history = screen.getByRole('heading', { level: 2, name: 'History' }).closest('section') as HTMLElement
    expect(within(history).getAllByText('curator_1').length).toBeGreaterThan(0)
    expect(within(history).getByText('Wagner Montes · Human')).toBeVisible()
    expect(within(history).getByText('7')).toBeVisible()
    expect(within(history).getByText(/no version comparison to show/)).toBeVisible()
  })

  test('advanced shows the loaded record as raw JSON and offers structured editing', async () => {
    setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const raw = document.querySelector('.ui-raw__json')
    expect(raw?.textContent).toContain(`"curation_id": "${CURATION_ID}"`)
    expect(raw?.textContent).toContain('"price_level": "$$"')
    // `sources` is a flexible value: Advanced is where its structured editor lives.
    expect(pathBlock('sources')).toBeVisible()
  })

  test('an unregistered legacy key is editable and PATCHes that key as the root', async () => {
    const { saveRecord } = setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const row = inspectorRow('price_level')
    expect(within(row).getByText('Not in the field registry')).toBeVisible()
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(row).getByLabelText('Price level'), { target: { value: '$$$$' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(saveRecord).toHaveBeenCalledWith({
        curationId: CURATION_ID,
        updates: { price_level: '$$$$' },
        expectedVersion: 7,
      })
    })
  })

  test('All fields searches the record by value as well as by field name', async () => {
    setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    fireEvent.change(screen.getByLabelText('Search fields'), { target: { value: 'Casual' } })

    expect(inspectorRow('categories.Mood')).toBeVisible()
    expect(screen.queryByText('restaurant_name')).toBeNull()
  })

  test('the outline names every section of the record column and links to it', async () => {
    setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const outline = screen.getByRole('navigation', { name: 'On this page' })
    const items = within(outline).getAllByRole('link')

    expect(items.map((item) => item.textContent)).toEqual([
      'About',
      'Your curation',
      'Concepts',
      'Curation evidence',
      'Collections',
      'History',
      'All fields',
      'Advanced',
    ])
    // Each item resolves to the heading of the section it names — the anchor
    // and the section are generated from the same title, and this is what keeps
    // them from drifting apart.
    for (const item of items) {
      const heading = screen.getByRole('heading', { level: 2, name: item.textContent ?? '' })
      expect(item).toHaveAttribute('href', `#${heading.id}`)
    }
  })

  test('the outline follows the section the reader picks', async () => {
    setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const outline = screen.getByRole('navigation', { name: 'On this page' })
    const media = within(outline).getByRole('link', { name: 'Curation evidence' })
    expect(media).not.toHaveAttribute('aria-current')
    expect(within(outline).getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'location')

    fireEvent.click(media)

    expect(media).toHaveAttribute('aria-current', 'location')
    expect(within(outline).getByRole('link', { name: 'About' })).not.toHaveAttribute('aria-current')
  })

  test('the rail carries the outline, the facts and the metadata of the record', async () => {
    setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const rail = screen.getByRole('complementary')
    expect(within(rail).getByRole('navigation', { name: 'On this page' })).toBeVisible()
    expect(within(rail).getByRole('heading', { level: 2, name: 'Facts' })).toBeVisible()
    expect(within(rail).getByRole('heading', { level: 2, name: 'Metadata' })).toBeVisible()

    /** The value of one fact, read the way the list pairs it with its label. */
    function fact(label: string): string {
      const term = within(rail).getAllByRole('term').find((node) => node.textContent === label)
      if (term === undefined) throw new Error(`No fact labelled "${label}"`)
      return term.nextElementSibling?.textContent ?? ''
    }

    expect(fact('Captured images')).toBe('1')
    expect(fact('Captured audio')).toBe('1')
    expect(fact('Other evidence')).toBe('1')
    expect(fact('Transcript')).toBe('Stored')
    expect(fact('Collections')).toBe('1 linked')
    expect(fact('Concepts')).toBe('3 categories')
  })

  test('shows the stored instant relatively and keeps the absolute date in the title', async () => {
    setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const updated = within(headerRegion()).getByText('Updated').closest('.ui-record-identity__fact') as HTMLElement
    const time = updated.querySelector('time')

    expect(time).not.toBeNull()
    expect(time).toHaveAttribute('datetime', '2026-09-13T12:00:00.000Z')
    expect(time).toHaveAttribute('title', new Date('2026-09-13T12:00:00.000Z').toLocaleString())
    expect(time?.textContent).not.toBe('2026-09-13T12:00:00.000Z')
  })

  test('keeps the Curation id in mono next to a way to copy it', async () => {
    setup()
    await screen.findByRole('heading', { level: 1, name: 'Ritz' })

    const header = headerRegion()
    expect(within(header).getByText(CURATION_ID)).toHaveClass('ui-detail-mono')
    expect(within(header).getByRole('button', { name: 'Copy id' })).toBeVisible()
  })
})
