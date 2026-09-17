import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { EntityImageThumbnail } from '../../../../src/components/entities/EntityImageThumbnail'

/**
 * The thumbnail is the only image the Entity page renders, and it is *display
 * media* — what the Collector card shows — never the curation evidence a curator
 * captured. So what it does when there is nothing to render is the behaviour
 * worth pinning: no `<img>`, no invented URL, no broken frame when the source
 * drops the image, and a line that names which of the two media is missing.
 */

afterEach(cleanup)

const HERO = { rank: 0, source: 'website_og', url: '/api/admin/v1/records/entities/ent_1/image?rank=0' }
const SECOND = { rank: 1, source: 'google_places', url: '/api/admin/v1/records/entities/ent_1/image?rank=1' }

describe('EntityImageThumbnail', () => {
  test('renders the image and its source when the gallery has one', () => {
    render(<EntityImageThumbnail state={{ status: 'ready', image: HERO }} />)

    expect(screen.getByRole('img', { name: 'Entity display media' })).toHaveAttribute('src', HERO.url)
    expect(screen.getByText('website_og')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open image' })).toHaveAttribute('href', HERO.url)
  })

  test('renders the rest of the ranked gallery as decorative thumbnails', () => {
    render(<EntityImageThumbnail state={{ gallery: [HERO, SECOND], image: HERO, status: 'ready' }} />)

    // A imagem nomeada é uma só: o resto da galeria é enfeite, com link nomeado.
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'Entity display media' })).toHaveAttribute('src', HERO.url)
    expect(screen.getByRole('link', { name: 'Open display media from google_places' })).toHaveAttribute(
      'href',
      SECOND.url,
    )
  })

  test('names the missing display media instead of rendering one', () => {
    render(<EntityImageThumbnail state={{ status: 'ready', image: null }} />)

    expect(screen.getByText('No display media: this Entity has no image the Collector card can show.')).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
    expect(document.querySelector('.entity-image__link')).toBeNull()
  })

  test('replaces an image that stops resolving with the same honest line', () => {
    render(<EntityImageThumbnail state={{ status: 'ready', image: HERO }} />)

    fireEvent.error(screen.getByRole('img', { name: 'Entity display media' }))

    expect(screen.getByText("This Entity's display media is no longer available at its source.")).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
  })

  test('reports a failed gallery read without claiming an image exists', () => {
    render(<EntityImageThumbnail state={{ status: 'error', error: 'The Entity service is unavailable.' }} />)

    expect(screen.getByText('The Entity service is unavailable.')).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
  })

  test('waits behind a skeleton while the gallery read is in flight', () => {
    render(<EntityImageThumbnail state={{ status: 'loading' }} />)

    expect(document.querySelectorAll('.ui-skeleton').length).toBeGreaterThan(0)
    expect(screen.getByText('Loading display media…')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('img')).toBeNull()
  })
})
