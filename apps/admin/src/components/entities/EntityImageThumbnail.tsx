'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Skeleton } from '../ui/Skeleton'
import type { EntityImage } from './entity-detail-client'

/** What the Media section knows about the Entity image at any moment. */
export type EntityImageState =
  | { status: 'loading' }
  | { status: 'ready'; image: EntityImage | null; gallery?: readonly EntityImage[] }
  | { status: 'error'; error: string }

/**
 * The Entity&apos;s **display media**: the hero the domain boundary resolved from the
 * Entity&apos;s own website/Place, plus the rest of its ranked gallery as
 * thumbnails — fetched through the Admin BFF so the browser sends its session
 * cookie and never the service key.
 *
 * Display media is not curation evidence. Evidence is what a curator captured
 * and it lives on the Curation; this is what the Collector card shows for the
 * Entity. Every line here therefore names *which* one is missing.
 *
 * Only a real image ever renders an `<img>`: without one the section says so,
 * and an image that stops resolving (the origin dropped it between the gallery
 * read and the fetch) falls back to the same honest line instead of leaving a
 * broken frame behind. The link is to the image the boundary serves — an origin
 * URL is deliberately never part of what the Admin receives. The gallery
 * thumbnails are decorative (`alt=""`): the hero is the image, and a screen
 * reader gets one named image instead of a list of unnamed ones.
 */
export function EntityImageThumbnail({ state }: { state: EntityImageState }): ReactNode {
  const [broken, setBroken] = useState(false)

  if (state.status === 'loading') {
    return (
      <div className="entity-image entity-image--loading">
        <p className="ui-visually-hidden" role="status">Loading display media…</p>
        <Skeleton variant="thumb" />
        <Skeleton width="40%" />
      </div>
    )
  }

  if (state.status === 'error') {
    return <p className="entity-image__status">{state.error}</p>
  }

  if (state.image === null) {
    return (
      <p className="entity-image__status">
        No display media: this Entity has no image the Collector card can show.
      </p>
    )
  }

  if (broken) {
    return (
      <p className="entity-image__status">
        This Entity&apos;s display media is no longer available at its source.
      </p>
    )
  }

  const hero = state.image
  const gallery = (state.gallery ?? []).filter((item) => item.url !== hero.url)

  return (
    <div className="entity-image">
      <figure className="entity-image__hero">
        <img
          alt="Entity display media"
          className="entity-image__thumb"
          onError={() => setBroken(true)}
          src={hero.url}
        />
        <figcaption className="entity-image__caption">
          <span className="entity-image__source">{hero.source}</span>
          <a className="entity-image__link" href={hero.url} rel="noreferrer" target="_blank">Open image</a>
        </figcaption>
      </figure>
      {gallery.length > 0 && (
        <ul aria-label="Entity display media gallery" className="entity-gallery">
          {gallery.map((item) => (
            <li key={item.url}>
              <a
                aria-label={`Open display media from ${item.source}`}
                className="entity-gallery__item"
                href={item.url}
                rel="noreferrer"
                target="_blank"
              >
                <img alt="" className="entity-gallery__thumb" loading="lazy" src={item.url} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
