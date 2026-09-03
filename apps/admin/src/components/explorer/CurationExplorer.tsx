'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeCurationFilters } from '../../explorer/normalize-filters'
import type { CurationFilters, CurationSearchPage, SelectionState } from '../../explorer/types'
import { BulkActionDialog } from '../operations/BulkActionDialog'
import { JobDrawer } from '../operations/JobDrawer'
import { SelectionToolbar } from './SelectionToolbar'
import { VirtualCurationTable } from './VirtualCurationTable'

type LoadPage = (input: { cursor: string | null; filters: CurationFilters }) => Promise<CurationSearchPage>

async function browserLoadPage({ cursor, filters }: { cursor: string | null; filters: CurationFilters }): Promise<CurationSearchPage> {
  const url = new URL('/api/admin/v1/curations', window.location.origin)
  if (cursor) url.searchParams.set('cursor', cursor)
  for (const [key, value] of Object.entries(normalizeCurationFilters(filters))) {
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item))
    else url.searchParams.set(key, value)
  }
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Unable to load Curations')
  return await response.json() as CurationSearchPage
}

const SELECTION_READY_POLL_MS = 1_000
// The materialization worker runs on a 1-minute cron cadence, so a selection
// can legitimately take up to ~61s to reach ready. A 30s deadline lost the
// race by seconds (client gave up right before the worker's next tick).
const SELECTION_READY_TIMEOUT_MS = 90_000

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Gmail-like selection intent over pages; it never expands all-matching into browser IDs. */
export function CurationExplorer({
  loadPage = browserLoadPage,
  targetCollectionId = null,
}: {
  loadPage?: LoadPage
  targetCollectionId?: string | null
}) {
  const [filters, setFilters] = useState<CurationFilters>({})
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<CurationSearchPage>({ items: [], next_cursor: null, total: null })
  const [selection, setSelection] = useState<SelectionState>({ mode: 'explicit', selected: new Set() })
  const [error, setError] = useState<string | null>(null)
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applySelection, setApplySelection] = useState<string | null>(null)
  const [showJobs, setShowJobs] = useState(false)
  const [lastPostedOperation, setLastPostedOperation] = useState<string | null>(null)
  const pollController = useRef<AbortController | null>(null)

  useEffect(() => () => pollController.current?.abort(), [])

  const load = useCallback(async (nextFilters: CurationFilters, cursor: string | null = null) => {
    try {
      setError(null)
      setPage(await loadPage({ cursor, filters: nextFilters }))
    } catch {
      setError('Unable to load Curations. Try again.')
    }
  }, [loadPage])

  useEffect(() => {
    let active = true
    void loadPage({ cursor: null, filters }).then(
      (nextPage) => { if (active) setPage(nextPage) },
      () => { if (active) setError('Unable to load Curations. Try again.') },
    )
    return () => { active = false }
  }, [filters, loadPage])

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSelection({ mode: 'explicit', selected: new Set() })
    setLastSelectedIndex(null)
    setFilters(normalizeCurationFilters({ ...filters, q: query }))
  }

  function toggle(curationId: string, index: number, shiftKey: boolean) {
    setSelection((current) => {
      if (current.mode === 'all_matching') {
        const excluded = new Set(current.excluded)
        if (excluded.has(curationId)) excluded.delete(curationId)
        else excluded.add(curationId)
        return { ...current, excluded }
      }
      const selected = new Set(current.selected)
      const start = shiftKey && lastSelectedIndex !== null ? Math.min(lastSelectedIndex, index) : index
      const end = shiftKey && lastSelectedIndex !== null ? Math.max(lastSelectedIndex, index) : index
      const shouldSelect = !selected.has(curationId)
      for (let cursor = start; cursor <= end; cursor += 1) {
        const row = page.items[cursor]
        if (row) shouldSelect ? selected.add(row.curation_id) : selected.delete(row.curation_id)
      }
      return { mode: 'explicit', selected }
    })
    setLastSelectedIndex(index)
  }

  function toggleAllLoaded(selectAll: boolean) {
    setSelection((current) => {
      if (current.mode === 'all_matching') return current
      const selected = new Set(current.selected)
      for (const row of page.items) {
        if (selectAll) selected.add(row.curation_id)
        else selected.delete(row.curation_id)
      }
      return { mode: 'explicit', selected }
    })
  }

  /** Shortcuts must never fire while the user is typing in an editable target. */
  function isEditableTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && Boolean(target.closest('input, textarea, [contenteditable="true"]'))
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (isEditableTarget(event.target)) return
    if (event.key.toLowerCase() === 'a' && selection.mode === 'explicit') {
      event.preventDefault()
      setSelection({ mode: 'all_matching', filters: normalizeCurationFilters(filters), excluded: new Set(), previewCount: page.total })
    }
  }

  /** Creates the server-side selection and polls until the manifest is ready. */
  const handleApplyToCollections = useCallback(async () => {
    if (applying) return
    setApplying(true)
    setApplyError(null)
    setLastPostedOperation(null)
    const controller = new AbortController()
    pollController.current = controller
    try {
      const body = selection.mode === 'explicit'
        ? { mode: 'explicit', curation_ids: [...selection.selected] }
        : { mode: 'all_matching', filters: selection.filters, excluded_ids: [...selection.excluded] }
      const response = await fetch('/api/admin/v1/selections', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': newId(), 'x-request-id': newId() },
        body: JSON.stringify(body),
      })
      const created = await response.json() as { id?: string }
      if (!response.ok || !created.id) throw new Error('unable_to_create_selection')
      const deadline = Date.now() + SELECTION_READY_TIMEOUT_MS
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, SELECTION_READY_POLL_MS))
        if (controller.signal.aborted) return
        const pollResponse = await fetch(`/api/admin/v1/selections/${created.id}`, { credentials: 'same-origin', signal: controller.signal })
        if (pollResponse.status === 410) throw new Error('selection_expired')
        if (!pollResponse.ok) throw new Error('unable_to_create_selection')
        const selectionRecord = await pollResponse.json() as { status?: string }
        if (selectionRecord.status === 'ready') {
          setApplySelection(created.id)
          return
        }
      }
      throw new Error('selection_timeout')
    } catch (cause) {
      if (controller.signal.aborted) return
      setApplyError(cause instanceof Error && cause.message === 'selection_timeout'
        ? 'The selection is taking too long to materialize. Try again shortly.'
        : 'Unable to create the selection. Explicit selections are limited to 500 Curations — use "Select all matching" for more.')
    } finally {
      setApplying(false)
    }
  }, [applying, selection])

  const selected = (id: string) => selection.mode === 'all_matching' ? !selection.excluded.has(id) : selection.selected.has(id)

  return (
    <section className="curation-explorer" aria-labelledby="curation-explorer-title" onKeyDown={handleKeyDown}>
      <header>
        <p className="collection-views__eyebrow">Content</p>
        <h1 id="curation-explorer-title">Curation Explorer</h1>
        <p>Search Curations and build a server-side selection for a Collection draft.</p>
      </header>
      {targetCollectionId && (
        <aside className="curation-explorer__target" aria-label="Target Collection">
          <p>Selecting Curations for a Collection draft.</p>
          <a href={`/admin/collections/${encodeURIComponent(targetCollectionId)}`}>Back to Collection</a>
        </aside>
      )}
      {lastPostedOperation && (
        <aside className="curation-explorer__posted" role="status">
          <p>Bulk operation queued.</p>
          {targetCollectionId && <a href={`/admin/collections/${encodeURIComponent(targetCollectionId)}`}>Return to Collection</a>}
          <a href="/admin/operations">View Operations</a>
        </aside>
      )}
      <form onSubmit={search}>
        <label htmlFor="curation-search">Search Curations</label>
        <input id="curation-search" onChange={(event) => setQuery(event.target.value)} value={query} />
        <button type="submit">Search</button>
      </form>
      <SelectionToolbar
        applying={applying}
        onApplyToCollections={() => void handleApplyToCollections()}
        onSelectAllMatching={() => setSelection({ mode: 'all_matching', filters: normalizeCurationFilters(filters), excluded: new Set(), previewCount: page.total })}
        selection={selection}
        total={page.total}
      />
      {applyError && <p role="alert">{applyError}</p>}
      {error && <p role="alert">{error}</p>}
      <VirtualCurationTable
        height={600}
        isSelected={(row) => selected(row.curation_id)}
        onToggle={(row, index, shiftKey) => toggle(row.curation_id, index, shiftKey)}
        onToggleAllLoaded={toggleAllLoaded}
        rowHeight={44}
        rows={page.items}
        selectAllDisabled={selection.mode === 'all_matching'}
      />
      {page.next_cursor && <button onClick={() => void load(filters, page.next_cursor)} type="button">Next page</button>}
      {applySelection && (
        <BulkActionDialog
          initialCollectionId={targetCollectionId}
          onClose={() => setApplySelection(null)}
          onPosted={(operationId) => {
            setApplySelection(null)
            setLastPostedOperation(operationId)
            setShowJobs(true)
          }}
          selectionId={applySelection}
        />
      )}
      {showJobs && <JobDrawer onClose={() => setShowJobs(false)} />}
    </section>
  )
}