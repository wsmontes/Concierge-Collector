'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { EntityImage } from './entity-detail-client'

/** What the Media section knows about the Entity image at any moment. */
export type EntityImageState =
  | { status: 'loading' }
  | { status: 'ready'; image: EntityImage | null }
  | { status: 'error'; error: string }

/**
 * The Entity thumbnail (plan §17) — the top-ranked image the domain boundary
 * resolved from the Entity's own website/place_id, fetched through the Admin
 * BFF so the browser sends its session cookie and never the service key.
 *
 * Only a real image ever renders an `<img>`: without one the section says so,
 * and an image that stops resolving (the origin dropped it between the gallery
 * read and the fetch) falls back to the same honest line instead of leaving a
 * broken frame behind. The link is to the image the boundary serves — an origin
 * URL is deliberately never part of what the Admin receives.
 */
export function EntityImageThumbnail({ state }: { state: EntityImageState }): ReactNode {
  const [broken, setBroken] = useState(false)

  if (state.status === 'loading') {
    return <p className="entity-image__status" role="status">Loading Entity image…</p>
  }
  if (state.status === 'error') {
    return <p className="entity-image__status">{state.error}</p>
  }
  if (state.image === null) {
    return <p className="entity-image__status">No image is available for this Entity.</p>
  }
  if (broken) {
    return <p className="entity-image__status">This Entity image is no longer available.</p>
  }

  return (
    <figure className="entity-image">
      <img
        className="entity-image__thumb"
        src={state.image.url}
        alt="Entity image"
        onError={() => setBroken(true)}
      />
      <figcaption className="entity-image__caption">
        <span className="entity-image__source">{state.image.source}</span>
        <a className="entity-image__link" href={state.image.url} rel="noreferrer" target="_blank">Open image</a>
      </figcaption>
    </figure>
  )
}
