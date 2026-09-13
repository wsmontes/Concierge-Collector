'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { normalizeCurationFilters } from '../../explorer/normalize-filters'
import type { NormalizedCurationFilters } from '../../explorer/types'
import { CurationExplorer, type LoadPage } from '../explorer/CurationExplorer'
import type { SavedCurationViewsClient } from '../../explorer/saved-views-client'
import { readCurationListQuery, writeCurationListQuery } from '../../curations/list-query'

const LIST_PATH = '/admin/curations'
/** Our own pushes must notify the store too; `popstate` only fires for history navigation. */
const PUSH_EVENT = 'cms:curations-push'

/**
 * The URL is the source of truth for the Curations filters.
 *
 * They used to live only in React state, so a refresh, Back, or a pasted link
 * lost the search. `useSyncExternalStore` reads the browser's history as the
 * external store: `''` on the server (which cannot know it), the real query
 * string in the browser, and a re-read on `popstate`.
 */
function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('popstate', onStoreChange)
  window.addEventListener(PUSH_EVENT, onStoreChange)
  return () => {
    window.removeEventListener('popstate', onStoreChange)
    window.removeEventListener(PUSH_EVENT, onStoreChange)
  }
}

function searchSnapshot(): string {
  return window.location.search
}

function serverSnapshot(): string {
  return ''
}

/**
 * Hydration flag, kept as stable module-level callbacks: an inline function
 * would resubscribe the store on every render.
 */
const subscribeHydration = () => () => {}
const hydratedSnapshot = () => true
const serverOnlySnapshot = () => false

export function CurationsWorkspace({
  loadPage,
  savedViewsClient,
  targetCollectionId = null,
}: {
  loadPage?: LoadPage
  savedViewsClient?: SavedCurationViewsClient
  /** Set when the list was opened from a Collection draft, so the bulk dialog can preselect it. */
  targetCollectionId?: string | null
}) {
  const search = useSyncExternalStore(subscribe, searchSnapshot, serverSnapshot)

  // Memoized on the query string: the Explorer re-applies the prop only when the
  // object identity changes, so a fresh object every render would loop.
  const filters = useMemo<NormalizedCurationFilters>(
    () => normalizeCurationFilters(readCurationListQuery(new URLSearchParams(search))),
    [search],
  )

  const onFiltersChange = useCallback((next: NormalizedCurationFilters) => {
    window.history.pushState(null, '', urlFor(next))
    window.dispatchEvent(new Event(PUSH_EVENT))
  }, [])

  // The server render has no URL, so the list would flash an unfiltered page and
  // then fetch again. Waiting for the first browser snapshot avoids that.
  const hydrated = useSyncExternalStore(subscribeHydration, hydratedSnapshot, serverOnlySnapshot)
  if (!hydrated) return <p role="status">Loading Curations…</p>

  return (
    <CurationExplorer
      initialFilters={filters}
      loadPage={loadPage}
      onFiltersChange={onFiltersChange}
      savedViewsClient={savedViewsClient}
      targetCollectionId={targetCollectionId}
    />
  )
}

function urlFor(filters: NormalizedCurationFilters): string {
  const query = writeCurationListQuery({
    q: filters.q,
    city: filters.city,
    entity_type: filters.entity_type,
    curator_id: filters.curator_id,
    status: filters.status,
  })
  return query ? `${LIST_PATH}?${query}` : LIST_PATH
}
