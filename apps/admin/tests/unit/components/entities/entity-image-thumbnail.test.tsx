import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { EntityImageThumbnail } from '../../../../src/components/entities/EntityImageThumbnail'

/**
 * The thumbnail is the only image the Entity page renders, so what it does when
 * there is nothing to render is the behaviour worth pinning: no `<img>`, no
 * invented URL, and no broken frame when the origin drops the image after the
 * gallery was read.
 */

afterEach(cleanup)

const HERO = { rank: 0, source: 'website_og', url: '/api/admin/v1/records/entities/ent_1/image?rank=0' }

describe('EntityImageThumbnail', () => {
  test('renders the image and its source when the gallery has one', () => {
    render(<EntityImageThumbnail state={{ status: 'ready', image: HERO }} />)

    expect(screen.getByRole('img', { name: 'Entity image' })).toHaveAttribute('src', HERO.url)
    expect(screen.getByText('website_og')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open image' })).toHaveAttribute('href', HERO.url)
  })

  test('names the missing image instead of rendering one', () => {
    render(<EntityImageThumbnail state={{ status: 'ready', image: null }} />)

    expect(screen.getByText('No image is available for this Entity.')).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
    expect(document.querySelector('.entity-image__link')).toBeNull()
  })

  test('replaces an image that stops resolving with the same honest line', () => {
    render(<EntityImageThumbnail state={{ status: 'ready', image: HERO }} />)

    fireEvent.error(screen.getByRole('img', { name: 'Entity image' }))

    expect(screen.getByText('This Entity image is no longer available.')).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
  })

  test('reports a failed gallery read without claiming an image exists', () => {
    render(<EntityImageThumbnail state={{ status: 'error', error: 'The Entity service is unavailable.' }} />)

    expect(screen.getByText('The Entity service is unavailable.')).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
  })
})
