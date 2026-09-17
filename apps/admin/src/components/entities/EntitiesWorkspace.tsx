'use client'

import { Button } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { EntityRow, EntitySearchPage, LoadEntityPage, LoadEntityRecord } from '../../content/record-types'
import { AdminPage } from '../ui/AdminPage'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { EntitiesFilterForm, type EntityFilterDraft } from './EntitiesFilterForm'
import { EntityPreviewDrawer } from './EntityPreviewDrawer'
import { EntityTable } from './EntityTable'
import { browserLoadEntityPage, browserLoadEntityRecord } from './entity-client'
import { parseEntityListState, writeEntityListState, type EntityListState } from './entity-url-state'

const TABLE_HEIGHT = 600
const ROW_HEIGHT = 48

function defaultNavigate(href: string) {
  window.location.assign(href)
}

export interface EntitiesWorkspaceProps {
  initialQuery?: string | null
  loadPage?: LoadEntityPage
  loadRecord?: LoadEntityRecord
  navigate?: (href: string) => void
}

/**
 * The Entities list (plan §20): the whole catalog of places, its filters, and
 * a side preview that never costs the operator their scroll position.
 *
 * All list state lives in the query string — `q`, `type`, `status`, `cursor` —
 * read on mount and rewritten in place, without a router navigation.
 */
export function EntitiesWorkspace({
  initialQuery,
  loadPage = browserLoadEntityPage,
  loadRecord = browserLoadEntityRecord,
  navigate = defaultNavigate,
}: EntitiesWorkspaceProps): ReactNode {
  // The query string the surface mounted with. Keys this surface does not own
  // ride along on every rewrite, so a foreign deep link survives a filter.
  const [preserved] = useState(() => (typeof initialQuery === 'string' ? initialQuery : window.location.search))
  const [applied, setApplied] = useState<EntityListState>(() => parseEntityListState(preserved))
  const [draft, setDraft] = useState<EntityFilterDraft>(() => ({
    q: applied.q,
    type: applied.type ?? '',
    status: applied.status ?? '',
  }))
  const [page, setPage] = useState<EntitySearchPage>({ items: [], next_cursor: null, total: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<EntityRow | null>(null)

  useEffect(() => {
    writeEntityListState(applied, preserved)
  }, [applied, preserved])

  useEffect(() => {
    let active = true
    void loadPage({
      cursor: applied.cursor,
      query: applied.q,
      type: applied.type,
      status: applied.status,
    }).then(
      (nextPage) => {
        if (!active) return
        setPage(nextPage)
        setError(null)
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('The Entity service did not answer this read.')
        setLoading(false)
      },
    )
    return () => { active = false }
  }, [applied, loadPage])

  function applyFilters() {
    setLoading(true)
    setApplied({ cursor: null, q: draft.q.trim(), type: draft.type || null, status: draft.status || null })
  }

  function resetFilters() {
    setDraft({ q: '', type: '', status: '' })
    setLoading(true)
    setApplied({ cursor: null, q: '', type: null, status: null })
  }

  function nextPage() {
    if (!page.next_cursor) return
    setLoading(true)
    setApplied((current) => ({ ...current, cursor: page.next_cursor }))
  }

  function reload() {
    setLoading(true)
    setApplied((current) => ({ ...current }))
  }

  const filtered = Boolean(applied.q || applied.type || applied.status)

  return (
    <AdminPage
      breadcrumb={[{ href: '/admin', label: 'Dashboard' }, { label: 'Entities' }]}
      className="entities-workspace"
      description="Every place, hotel and venue the platform knows about — find it, filter it, and open the full record."
      eyebrow="Content"
      sticky
      title="Entities"
      width="wide"
    >
      <EntitiesFilterForm value={draft} onChange={setDraft} onApply={applyFilters} onReset={resetFilters} />

      {error !== null ? (
        <ErrorState
          description={error}
          onRetry={reload}
          retryLabel="Try again"
          title="Unable to load Entities"
        />
      ) : (
        <>
          {loading && (
            <p className="ui-visually-hidden" role="status">Loading Entities…</p>
          )}
          <EntityTable
            empty={(
              <EmptyState
                action={filtered
                  ? (
                      <Button buttonStyle="secondary" margin={false} onClick={resetFilters} type="button">
                        Clear filters
                      </Button>
                    )
                  : undefined}
                description={filtered
                  ? 'Change the current filters, or clear them to browse the whole catalog.'
                  : 'Nothing has been captured into the catalog yet.'}
                title={filtered ? 'No Entities match' : 'No Entities yet'}
              />
            )}
            footer={(
              <>
                <span className="entity-table__count">
                  {typeof page.total === 'number'
                    ? `${page.items.length.toLocaleString()} of ${page.total.toLocaleString()} Entities`
                    : `${page.items.length.toLocaleString()} Entities`}
                </span>
                {page.next_cursor !== null && (
                  <Button
                    buttonStyle="secondary"
                    disabled={loading}
                    margin={false}
                    onClick={nextPage}
                    size="small"
                    type="button"
                  >
                    Next page
                  </Button>
                )}
              </>
            )}
            height={TABLE_HEIGHT}
            loading={loading}
            navigate={navigate}
            onOpenRow={setPreview}
            rowHeight={ROW_HEIGHT}
            rows={loading ? [] : page.items}
          />
        </>
      )}

      {preview !== null && (
        <EntityPreviewDrawer
          entity={preview}
          key={preview.id}
          loadRecord={loadRecord}
          onClose={() => setPreview(null)}
        />
      )}
    </AdminPage>
  )
}
