'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useTheme } from '@payloadcms/ui'
import { useAdminUi } from '../shell/AdminUiContext'
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
  /** Controlado pela casca quando os gatilhos vivem fora da paleta. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Uma ação da paleta: navegar, alternar o tema, abrir a ajuda de atalhos. */
interface PaletteCommand {
  id: string
  label: string
  hint?: string
  run: () => void
}

const COMMAND_ROUTES: Array<{ label: string; href: string }> = [
  { label: 'Go to Dashboard', href: '/admin' },
  { label: 'Go to Curations', href: '/admin/curations' },
  { label: 'Go to Entities', href: '/admin/entities' },
  { label: 'Go to Collections', href: '/admin/collections/collections' },
  { label: 'Go to Applications', href: '/admin/applications' },
  { label: 'Go to Operations', href: '/admin/operations' },
]

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
  open: controlledOpen,
  onOpenChange,
}: GlobalSearchProps): ReactNode {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange],
  )
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
  }, [setOpen])

  /**
   * Ações da paleta. Aparecem quando não há termo: a paleta responde "o que eu
   * faço agora", não só "onde está este registro" — e o teclado é o mesmo
   * (setas + Enter), então nada aqui precisa de mouse.
   */
  const { openShortcuts } = useAdminUi()
  const { theme, setTheme } = useTheme()
  const commands = useMemo<PaletteCommand[]>(
    () => [
      ...COMMAND_ROUTES.map((route) => ({
        id: `route:${route.href}`,
        label: route.label,
        run: () => navigate(route.href),
      })),
      {
        id: 'theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      { id: 'shortcuts', label: 'Keyboard shortcuts', hint: '?', run: openShortcuts },
    ],
    [navigate, openShortcuts, setTheme, theme],
  )
  const idle = phase === 'idle'
  const optionCount = idle ? commands.length : rows.length

  const runCommand = useCallback(
    (index: number) => {
      const command = commands[index]
      if (!command) return
      command.run()
      closePalette()
    },
    [closePalette, commands],
  )

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
  }, [closePalette, open, setOpen])

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
    if (optionCount === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, optionCount - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (idle) runCommand(activeIndex)
      else openRow(rows[activeIndex])
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

            {idle && (
              <>
                <p className="search-palette__status">
                  Start typing to search Entities, Curations and Collections by name.
                </p>
                <ul aria-label="Commands" className="ui-menu search-palette__commands">
                  {commands.map((command, index) => (
                    <li key={command.id}>
                      <button
                        className="ui-menu__item"
                        data-active={index === activeIndex ? 'true' : undefined}
                        onClick={() => runCommand(index)}
                        onFocus={() => setActiveIndex(index)}
                        type="button"
                      >
                        <span>{command.label}</span>
                        {command.hint && <kbd className="ui-keyhint">{command.hint}</kbd>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
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
