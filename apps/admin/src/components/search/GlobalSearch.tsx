'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { GlobalSearchResults } from './GlobalSearchResults'
import { browserLoadResults } from './search-client'
import { buildSearchGroups, flattenSearchGroups, searchOptionId, type SearchRow } from './search-rows'
import type { SearchResults } from './search-types'

export type { CollectionHit, SearchResults } from './search-types'

/** How long typing settles before the palette asks the BFF. */
export const SEARCH_DEBOUNCE_MS = 250

const NO_RESULTS: SearchResults = { entities: [], curations: [], collections: [] }
const SEARCH_ERROR_MESSAGE = 'Search is unavailable right now. Try again.'

export interface GlobalSearchProps {
  loadResults?: (query: string) => Promise<SearchResults>
  navigate?: (href: string) => void
}

/** The answer the palette holds, tagged with the query it answers. */
interface SearchAnswer {
  term: string
  outcome: 'ready' | 'error'
  results: SearchResults
  error: string | null
}

const NO_ANSWER: SearchAnswer = { term: '', outcome: 'ready', results: NO_RESULTS, error: null }

type PalettePhase = 'idle' | 'loading' | 'ready' | 'error'

function defaultNavigate(href: string) {
  window.location.assign(href)
}

/**
 * The global search palette (plan §26): one query over Entities, Curations and
 * Collections, reachable from ⌘K/Ctrl+K or the visible trigger, and answerable
 * by any loader the mounting page injects.
 *
 * The interaction rests on two invariants. A slow answer never overwrites a
 * newer one: every request takes a ticket and a response whose ticket is stale
 * is dropped on arrival. And the palette is never blank once open: idle,
 * loading, empty, error and results are five explicit states, four of them
 * derived from the query itself rather than stored.
 */
export function GlobalSearch({
  loadResults = browserLoadResults,
  navigate = defaultNavigate,
}: GlobalSearchProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState<SearchAnswer>(NO_ANSWER)
  const [activeIndex, setActiveIndex] = useState(0)
  const [attempt, setAttempt] = useState(0)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const focusOwnerRef = useRef(false)
  const sequenceRef = useRef(0)
  // The loader is read through a ref so the debounce effect stays keyed on the
  // query alone: an inline `loadResults` prop must not restart — or loop — the
  // search every time this component renders.
  const loaderRef = useRef(loadResults)

  const term = query.trim()
  // The phase is derived, not stored: an answer for another term is not this
  // term's answer, which is what makes typing show loading in the same render.
  const phase: PalettePhase = term.length === 0 ? 'idle' : answer.term === term ? answer.outcome : 'loading'
  const groups = useMemo(
    () => buildSearchGroups(phase === 'ready' ? answer.results : NO_RESULTS),
    [phase, answer.results],
  )
  const rows = useMemo(() => flattenSearchGroups(groups), [groups])

  const closePalette = useCallback(() => {
    // Bumping the ticket parks whatever is in flight: its answer is no longer
    // about a query the operator can still see.
    sequenceRef.current += 1
    setOpen(false)
    setQuery('')
    setAnswer(NO_ANSWER)
    setActiveIndex(0)
  }, [])

  useEffect(() => {
    loaderRef.current = loadResults
  }, [loadResults])

  // Focus moves into the field on open and back to the trigger on close. The
  // first render must not steal focus, hence the owner flag.
  useEffect(() => {
    if (open) {
      focusOwnerRef.current = true
      inputRef.current?.focus()
      return
    }
    if (focusOwnerRef.current) {
      focusOwnerRef.current = false
      triggerRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
        return
      }
      if (event.key === 'Escape' && open) closePalette()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, closePalette])

  useEffect(() => {
    const ticket = sequenceRef.current + 1
    sequenceRef.current = ticket
    if (!open || term.length === 0) return undefined

    const timer = setTimeout(() => {
      loaderRef.current(term).then(
        (next) => {
          if (sequenceRef.current !== ticket) return
          setAnswer({ term, outcome: 'ready', results: next, error: null })
          setActiveIndex(0)
        },
        () => {
          if (sequenceRef.current !== ticket) return
          setAnswer({ term, outcome: 'error', results: NO_RESULTS, error: SEARCH_ERROR_MESSAGE })
        },
      )
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [open, term, attempt])

  const openRow = useCallback((row: SearchRow | undefined) => {
    if (!row) return
    navigate(row.href)
    closePalette()
  }, [navigate, closePalette])

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (rows.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, rows.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      openRow(rows[activeIndex])
    }
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-label="Global search"
        className="search-palette__trigger"
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true">Search</span>
        <kbd aria-hidden="true" className="search-palette__trigger-hint">⌘K</kbd>
      </button>

      {open && (
        <div className="search-palette__overlay" onClick={closePalette}>
          <div
            aria-label="Global search"
            aria-modal="true"
            className="search-palette__panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <input
              aria-activedescendant={rows.length > 0 ? searchOptionId(activeIndex) : undefined}
              aria-controls="global-search-results"
              aria-label="Global search"
              autoComplete="off"
              className="search-palette__input"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search Entities, Curations and Collections"
              ref={inputRef}
              type="text"
              value={query}
            />

            {phase === 'loading' && <p className="search-palette__status" role="status">Searching…</p>}

            {phase === 'idle' && (
              <p className="search-palette__status">
                Start typing to search Entities, Curations and Collections by name.
              </p>
            )}

            {phase === 'error' && answer.error !== null && (
              <div className="search-palette__error" role="alert">
                <p>{answer.error}</p>
                <button
                  className="search-palette__retry"
                  onClick={() => setAttempt((value) => value + 1)}
                  type="button"
                >
                  Try again
                </button>
              </div>
            )}

            {phase === 'ready' && rows.length === 0 && (
              <p className="search-palette__status" role="status">
                No matches for “{term}”.
              </p>
            )}

            {rows.length > 0 && <GlobalSearchResults activeIndex={activeIndex} groups={groups} onOpen={openRow} />}

            <p className="search-palette__footer">↑↓ to move · Enter to open · Esc to close</p>
          </div>
        </div>
      )}
    </>
  )
}
