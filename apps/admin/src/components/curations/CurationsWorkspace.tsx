'use client'

import { Button } from '@payloadcms/ui'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeCurationColumns, type CurationColumnId } from '../../content/curation-columns'
import type { CurationRecordResponse, CurationSort, LoadCurationRecord } from '../../content/record-types'
import { normalizeCurationFilters } from '../../explorer/normalize-filters'
import { savedViewColumns, savedViewSort, type SavedCurationView, type SavedCurationViewsClient } from '../../explorer/saved-views-client'
import { parseCurationListState, serializeCurationListState, whereParameter, type CurationListState } from '../../explorer/url-state'
import type {
  AdminCurationRow,
  CurationConceptFilter,
  CurationFilters,
  CurationSearchPage,
  LoadCurationPage,
  LoadCurationPageInput,
  NormalizedCurationFilters,
  SelectionState,
  WhereClause,
} from '../../explorer/types'
import { BulkActionDialog } from '../operations/BulkActionDialog'
import { JobDrawer } from '../operations/JobDrawer'
import { AdminPage } from '../ui/AdminPage'
import { Chip } from '../ui/Chip'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { SelectInput } from '../ui/Field'
import { InlineNotice } from '../ui/InlineNotice'
import { CurationColumnPicker } from './CurationColumnPicker'
import { CurationPreviewDrawer } from './CurationPreviewDrawer'
import { CurationSortPicker } from './CurationSortPicker'
import { CurationTable, type CurationDensity } from './CurationTable'
import { CurationsFilterForm } from './CurationsFilterForm'
import { CurationsSavedViews } from './CurationsSavedViews'
import { CurationsSelectionToolbar } from './CurationsSelectionToolbar'

async function browserLoadPage({ cursor, filters, sort }: LoadCurationPageInput): Promise<CurationSearchPage> {
  const url = new URL('/api/admin/v1/curations', window.location.origin)
  if (cursor) url.searchParams.set('cursor', cursor)
  if (sort) url.searchParams.set('sort', sort)
  // Concept facets and advanced conditions have their own key shapes
  // (`concept.<Category>`, repeated `where`), so they are appended outside the
  // flat filter loop.
  const { concepts = [], where = [], ...flat } = normalizeCurationFilters(filters)
  for (const [key, value] of Object.entries(flat)) {
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item))
    else if (value) url.searchParams.set(key, String(value))
  }
  for (const concept of concepts) url.searchParams.append(`concept.${concept.category}`, concept.value)
  for (const clause of where) url.searchParams.append('where', whereParameter(clause))
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Unable to load Curations')
  return await response.json() as CurationSearchPage
}

async function browserLoadRecord(curationId: string): Promise<CurationRecordResponse> {
  const response = await fetch(`/api/admin/v1/records/curations/${encodeURIComponent(curationId)}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Unable to load this Curation')
  return await response.json() as CurationRecordResponse
}

/**
 * The exhaustive count of the "Without Collections" view, read from the
 * content-health counter: the boundary's own answer over the whole catalog.
 * The filtered listing itself only ever sees one materialized page, so it can
 * never count this view — and a number nobody measured is rendered as unknown.
 */
async function browserLoadWithoutCollectionsCount(): Promise<number | null> {
  const response = await fetch('/api/admin/v1/records/content-health', { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Unable to load the Without Collections count')
  const body = await response.json() as { without_collections?: unknown }
  return typeof body.without_collections === 'number' ? body.without_collections : null
}

const SELECTION_READY_POLL_MS = 1_000
const SELECTION_READY_TIMEOUT_MS = 90_000

/** Altura da janela de rolagem da tabela, em pixels. */
const TABLE_HEIGHT = 600

const DENSITY_OPTIONS = [
  { label: 'Comfortable', value: 'comfortable' },
  { label: 'Compact', value: 'compact' },
] as const

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** The list-state fields a normalized filter set owns. */
function filtersPatch(filters: NormalizedCurationFilters): Partial<CurationListState> {
  return {
    q: filters.q ?? null,
    status: filters.status ?? [],
    city: filters.city ?? null,
    entity_type: filters.entity_type ?? null,
    curator_id: filters.curator_id ?? null,
    unlinked: filters.unlinked === true,
    without_collections: filters.without_collections === true,
    concepts: filters.concepts ?? [],
    where: filters.where ?? [],
  }
}

/**
 * The Curations list (plan §4/§11/§27/§28): one URL-backed state drives the
 * search, the sort, the columns and the pagination cursor, and the Gmail-like
 * selection intent is carried over unchanged so a bulk operation still starts
 * from exactly what the operator sees.
 */
export function CurationsWorkspace({
  loadPage = browserLoadPage,
  loadRecord = browserLoadRecord,
  loadWithoutCollectionsCount = browserLoadWithoutCollectionsCount,
  targetCollectionId = null,
  savedViewsClient,
  initialQuery = null,
  initialColumns = null,
}: {
  loadPage?: LoadCurationPage
  loadRecord?: LoadCurationRecord
  /** The exhaustive "Without Collections" counter, from the content-health path. */
  loadWithoutCollectionsCount?: () => Promise<number | null>
  targetCollectionId?: string | null
  savedViewsClient?: SavedCurationViewsClient
  /** Server-provided query string (or search params) the surface boots from. */
  initialQuery?: string | URLSearchParams | null
  /** Column set to use when the URL carries none. */
  initialColumns?: readonly CurationColumnId[] | null
}) {
  const [state, setState] = useState<CurationListState>(() => parseCurationListState(initialQuery, initialColumns))
  const [draft, setDraft] = useState<CurationFilters>(() => {
    const boot = parseCurationListState(initialQuery, initialColumns)
    return {
      q: boot.q,
      status: boot.status,
      city: boot.city,
      entity_type: boot.entity_type,
      curator_id: boot.curator_id,
      unlinked: boot.unlinked,
      without_collections: boot.without_collections,
      concepts: boot.concepts,
      where: boot.where,
    }
  })
  const [page, setPage] = useState<CurationSearchPage>({ items: [], next_cursor: null, total: null })
  const [settledRequest, setSettledRequest] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [density, setDensity] = useState<CurationDensity>('comfortable')
  const [selection, setSelection] = useState<SelectionState>({ mode: 'explicit', selected: new Set() })
  const [preview, setPreview] = useState<AdminCurationRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applySelection, setApplySelection] = useState<string | null>(null)
  const [showJobs, setShowJobs] = useState(false)
  const [lastPostedOperation, setLastPostedOperation] = useState<string | null>(null)
  const [withoutCollectionsCount, setWithoutCollectionsCount] = useState<number | null>(null)
  const pollController = useRef<AbortController | null>(null)
  const preservedQuery = useRef<string | URLSearchParams | null>(initialQuery)
  const { q, status, city, entity_type, curator_id, unlinked, without_collections, concepts, where } = state

  useEffect(() => () => pollController.current?.abort(), [])

  // Columns and cursor are deliberately out of these deps: changing either must
  // not re-run the search, only re-render the table. The advanced conditions
  // are normalized with the flat draft so the all-matching intent carries the
  // exact predicate the list was filtered by.
  const filters = useMemo(
    () => normalizeCurationFilters({ q, status, city, entity_type, curator_id, unlinked, without_collections, concepts }, where),
    [q, status, city, entity_type, curator_id, unlinked, without_collections, concepts, where],
  )

  // A requisição em voo é identificada pelo que ela lê — cursor, sort, filtros —
  // e pelo token de retry. Comparar as chaves é o que responde "ainda não
  // chegou" sem escrever estado dentro do efeito.
  const requestKey = `${reloadToken}|${state.cursor ?? ''}|${state.sort}|${JSON.stringify(filters)}`

  // The mode's header count is the content-health counter, asked for only while
  // the mode is on. A counter the boundary did not report stays null: unknown,
  // never invented from the page that happens to be loaded.
  useEffect(() => {
    if (!without_collections) return
    let active = true
    void loadWithoutCollectionsCount().then(
      (count) => { if (active) setWithoutCollectionsCount(count) },
      () => { if (active) setWithoutCollectionsCount(null) },
    )
    return () => { active = false }
  }, [loadWithoutCollectionsCount, without_collections])

  useEffect(() => {
    let active = true
    void loadPage({ cursor: state.cursor, filters, sort: state.sort }).then(
      (nextPage) => {
        if (!active) return
        setPage(nextPage)
        setSettledRequest(requestKey)
        setError(null)
      },
      () => {
        if (!active) return
        setSettledRequest(requestKey)
        setError('Unable to load Curations. Try again.')
      },
    )
    return () => { active = false }
  }, [filters, loadPage, reloadToken, requestKey, state.cursor, state.sort])

  // The query string is the state (plan §28). replaceState keeps the operator's
  // scroll, focus and history intact; foreign keys of the incoming URL survive.
  useEffect(() => {
    const search = serializeCurationListState(state, preservedQuery.current)
    preservedQuery.current = search
    if (typeof window === 'undefined' || !window.history) return
    window.history.replaceState(null, '', `${window.location.pathname}${search.length > 0 ? `?${search}` : ''}`)
  }, [state])

  function resetSelection() {
    setSelection({ mode: 'explicit', selected: new Set() })
    setLastSelectedIndex(null)
    setApplyError(null)
    setLastPostedOperation(null)
  }

  function applyFilters(next: CurationFilters = draft) {
    const normalized = normalizeCurationFilters(next)
    // Ligar/desligar o modo "sem Collections" recomeça o contador em
    // desconhecido ("—") até o boundary responder, em vez de exibir o número
    // do modo anterior.
    if ((normalized.without_collections === true) !== without_collections) setWithoutCollectionsCount(null)
    resetSelection()
    setDraft(normalized)
    setState((current) => ({ ...current, ...filtersPatch(normalized), cursor: null }))
  }

  function clearFilters() {
    resetSelection()
    setDraft({})
    setState((current) => ({ ...current, ...filtersPatch({}), cursor: null }))
  }

  function removeConcept(concept: CurationConceptFilter) {
    applyFilters({
      ...filters,
      concepts: (filters.concepts ?? []).filter((entry) => entry.category !== concept.category || entry.value !== concept.value),
    })
  }

  /** A chip removes exactly the clause it renders, identified by its wire form. */
  function removeWhere(clause: WhereClause) {
    const key = whereParameter(clause)
    applyFilters({ ...filters, where: (filters.where ?? []).filter((entry) => whereParameter(entry) !== key) })
  }

  function changeSort(sort: CurationSort) {
    setState((current) => (current.sort === sort ? current : { ...current, sort, cursor: null }))
  }

  function changeColumns(columns: readonly CurationColumnId[]) {
    const next = normalizeCurationColumns(columns)
    setState((current) => (current.columns.join(',') === next.join(',') ? current : { ...current, columns: next }))
  }

  function applySavedView(view: SavedCurationView) {
    const normalized = normalizeCurationFilters(view.normalizedFilters ?? {})
    resetSelection()
    setDraft(normalized)
    const columns = savedViewColumns(view)
    const sort = savedViewSort(view)
    setState((current) => ({
      ...current,
      ...filtersPatch(normalized),
      cursor: null,
      ...(columns ? { columns } : {}),
      ...(sort ? { sort } : {}),
    }))
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

  function isEditableTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (isEditableTarget(event.target)) return
    if (event.key.toLowerCase() === 'a' && selection.mode === 'explicit') {
      event.preventDefault()
      setSelection({ mode: 'all_matching', filters, excluded: new Set(), previewCount: page.total })
    }
  }

  const closePreview = useCallback(() => setPreview(null), [])

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
  const nextCursor = page.next_cursor
  const hasFilters = Object.keys(filters).length > 0
  // Enquanto a primeira página (ou a primeira de um filtro novo) não chegou, a
  // tabela mostra esqueleto no lugar das linhas: nunca um "Loading…".
  const loadingRows = page.items.length === 0 && error === null && settledRequest !== requestKey

  return (
    <AdminPage
      className="curations-workspace"
      eyebrow="Content"
      title="Curations"
      description="Search and filter Curations, then build a server-side selection for one or more Collection drafts."
      width="wide"
      actions={without_collections ? (
        <Chip size="sm">
          {withoutCollectionsCount === null
            ? 'Without Collections: —'
            : `${withoutCollectionsCount.toLocaleString('en-US')} without Collections`}
        </Chip>
      ) : undefined}
    >
      <div className="curations-workspace__workspace" onKeyDown={handleKeyDown}>
        {targetCollectionId && (
          <InlineNotice
            tone="info"
            action={<Link href={`/admin/collections/collections/${encodeURIComponent(targetCollectionId)}`}>Back to Collection</Link>}
          >
            <p>Selecting Curations for a Collection draft.</p>
          </InlineNotice>
        )}
        {lastPostedOperation && (
          <InlineNotice
            tone="success"
            action={(
              <div className="curations-workspace__notice-actions">
                {targetCollectionId && <Link href={`/admin/collections/collections/${encodeURIComponent(targetCollectionId)}`}>Return to Collection</Link>}
                <Link href="/admin/operations">View Operations</Link>
              </div>
            )}
          >
            <p>Bulk operation queued.</p>
          </InlineNotice>
        )}
        <CurationsFilterForm
          applied={filters}
          onChange={setDraft}
          onApply={() => applyFilters()}
          onApplyValue={applyFilters}
          onClear={clearFilters}
          onRemoveConcept={removeConcept}
          onRemoveWhere={removeWhere}
          value={draft}
        >
          <div className="curations-workspace__density">
            <SelectInput
              id="curation-density"
              label="Rows"
              onChange={(next) => setDensity(next === 'compact' ? 'compact' : 'comfortable')}
              options={[...DENSITY_OPTIONS]}
              value={density}
            />
          </div>
          <CurationSortPicker onChange={changeSort} value={state.sort} />
          <CurationColumnPicker onChange={changeColumns} value={state.columns} />
          <CurationsSavedViews
            client={savedViewsClient}
            currentColumns={state.columns}
            currentFilters={filters}
            currentSort={state.sort}
            onApply={applySavedView}
          />
        </CurationsFilterForm>
        <CurationsSelectionToolbar
          applying={applying}
          onApplyToCollections={() => void handleApplyToCollections()}
          onSelectAllMatching={() => setSelection({ mode: 'all_matching', filters, excluded: new Set(), previewCount: page.total })}
          selection={selection}
          total={page.total}
        />
        {applyError && <InlineNotice tone="error"><p>{applyError}</p></InlineNotice>}
        {error ? (
          <ErrorState
            description={error}
            onRetry={() => setReloadToken((token) => token + 1)}
            retryLabel="Try again"
            title="Curations could not load"
          />
        ) : (
          <CurationTable
            columns={state.columns}
            density={density}
            empty={(
              <EmptyState
                action={hasFilters
                  ? (
                    <Button buttonStyle="secondary" margin={false} onClick={clearFilters} size="small" type="button">
                      Clear filters
                    </Button>
                  )
                  : undefined}
                title={without_collections ? 'No Curations without Collections' : hasFilters ? 'No Curations match' : 'No Curations yet'}
                // Uma página vazia não prova que TODA Curation está numa Collection:
                // só diz que esta view não tem o que paginar (o scan pode não
                // alcançar linhas sem `catalog_sequence`). O texto carrega o
                // qualificador em vez de afirmar o inverso do acervo.
                description={without_collections
                  ? 'No stored Curation in this view is missing from a Collection.'
                  : hasFilters
                    ? 'No stored Curation matches these filters.'
                    : 'The catalog has no stored Curations yet.'}
              />
            )}
            footer={(
              <>
                <span className="ui-table__secondary">
                  {`${page.items.length.toLocaleString('en-US')} loaded`}
                  {page.total === null ? '' : ` of ${page.total.toLocaleString('en-US')}`}
                </span>
                {nextCursor && (
                  <Button
                    buttonStyle="secondary"
                    margin={false}
                    onClick={() => setState((current) => ({ ...current, cursor: nextCursor }))}
                    size="small"
                    type="button"
                  >
                    Next page
                  </Button>
                )}
              </>
            )}
            height={TABLE_HEIGHT}
            isSelected={(row) => selected(row.curation_id)}
            loading={loadingRows}
            onOpenRow={setPreview}
            onToggle={(row, index, shiftKey) => toggle(row.curation_id, index, shiftKey)}
            onToggleAllLoaded={toggleAllLoaded}
            rows={page.items}
            selectAllDisabled={selection.mode === 'all_matching'}
          />
        )}
        {preview && <CurationPreviewDrawer key={preview.curation_id} loadRecord={loadRecord} onClose={closePreview} row={preview} />}
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
      </div>
    </AdminPage>
  )
}
