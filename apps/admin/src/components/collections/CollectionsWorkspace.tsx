'use client'

import { Button } from '@payloadcms/ui'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CollectionsAdminError,
  createBrowserCollectionsAdminClient,
  type AdminCollectionRecord,
  type CollectionsAdminClient,
} from '../../collections/admin-client'
import { AdminPage } from '../ui/AdminPage'
import { Chip } from '../ui/Chip'
import { DataTable, type DataTableColumn } from '../ui/DataTable'
import { EmptyState } from '../ui/EmptyState'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { ErrorState } from '../ui/ErrorState'
import { SelectInput } from '../ui/Field'
import { StatusPill } from '../ui/StatusPill'
import { SearchInput, Toolbar, ToolbarGroup } from '../ui/Toolbar'
import { NewCollectionDialog } from './NewCollectionDialog'

const browserCollectionsClient = createBrowserCollectionsAdminClient()

export interface CollectionsWorkspaceProps {
  client?: CollectionsAdminClient
  navigate?: (href: string) => void
}

function defaultNavigate(href: string) {
  window.location.assign(href)
}

function humanError(error: unknown): string {
  if (error instanceof CollectionsAdminError) {
    if (error.status === 401) return 'Your Admin session has expired.'
    if (error.status === 403) return 'Admin access is required.'
    if (error.status === 503) return 'Collections service is unavailable.'
    return error.code
  }
  return error instanceof Error ? error.message : 'request_failed'
}

/* ---------------------------------------------------------------------------
   Filtros na URL
   --------------------------------------------------------------------------- */

const LIFECYCLE_VALUES = ['all', 'draft', 'published', 'archived'] as const
const DRAFT_STATE_VALUES = ['all', 'clean', 'dirty', 'publishing', 'failed'] as const

type LifecycleFilter = (typeof LIFECYCLE_VALUES)[number]
type DraftStateFilter = (typeof DRAFT_STATE_VALUES)[number]

interface CollectionFilters {
  query: string
  lifecycle: LifecycleFilter
  draftState: DraftStateFilter
}

const EMPTY_FILTERS: CollectionFilters = { query: '', lifecycle: 'all', draftState: 'all' }

const LIFECYCLE_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Published', value: 'published' },
  { label: 'Archived', value: 'archived' },
]

const DRAFT_STATE_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Clean', value: 'clean' },
  { label: 'Dirty', value: 'dirty' },
  { label: 'Publishing', value: 'publishing' },
  { label: 'Failed', value: 'failed' },
]

function oneOf<T extends string>(values: readonly T[], candidate: string | null): T | null {
  return candidate !== null && (values as readonly string[]).includes(candidate) ? candidate as T : null
}

/** O filtro vive na URL para a lista ser um endereço, não um estado de sessão. */
function filtersFromLocation(): CollectionFilters {
  const params = new URLSearchParams(window.location.search)
  return {
    query: params.get('q') ?? '',
    lifecycle: oneOf(LIFECYCLE_VALUES, params.get('lifecycle')) ?? 'all',
    draftState: oneOf(DRAFT_STATE_VALUES, params.get('draftState')) ?? 'all',
  }
}

/**
 * Filtros de lista lidos da query e gravados de volta com `replaceState`.
 *
 * A primeira renderização usa o padrão porque o servidor não conhece a query —
 * ler a URL no inicializador do `useState` divergiria da hidratação. A leitura
 * acontece no efeito de montagem e a gravação só depois dela, para que o
 * primeiro efeito não apague a query que acabou de ser lida.
 */
function useCollectionFilters() {
  const [filters, setFilters] = useState<CollectionFilters>(EMPTY_FILTERS)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    // A query string só existe no cliente: lê-la durante o render daria mismatch
    // de hidratação (o servidor não tem `location`). Este é o caso legítimo de
    // sincronizar estado com um sistema externo no primeiro efeito, e a regra do
    // compilador é desativada aqui com esse motivo — em vez de inventar um
    // `useSyncExternalStore` para um valor que não muda sem navegação.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window.location só existe depois da montagem
    setFilters(filtersFromLocation())
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const params = new URLSearchParams(window.location.search)
    const next: Record<string, string> = {
      q: filters.query.trim(),
      lifecycle: filters.lifecycle,
      draftState: filters.draftState,
    }
    for (const [key, value] of Object.entries(next)) {
      if (value === '' || value === 'all') params.delete(key)
      else params.set(key, value)
    }
    const search = params.toString()
    const target = `${window.location.pathname}${search ? `?${search}` : ''}`
    const current = `${window.location.pathname}${window.location.search}`
    if (target !== current) window.history.replaceState(null, '', target)
  }, [filters, hydrated])

  return [filters, setFilters] as const
}

export function CollectionsWorkspace({
  client = browserCollectionsClient,
  navigate = defaultNavigate,
}: CollectionsWorkspaceProps) {
  const [rows, setRows] = useState<AdminCollectionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useCollectionFilters()
  const [creating, setCreating] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await client.list())
      setError(null)
    } catch (cause) {
      setError(humanError(cause))
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const next = await client.list()
        if (!active) return
        setRows(next)
        setError(null)
      } catch (cause) {
        if (active) setError(humanError(cause))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [client])

  const visible = useMemo(() => {
    const normalizedQuery = filters.query.trim().toLocaleLowerCase()
    return rows.filter((row) => (
      (!normalizedQuery || row.title.toLocaleLowerCase().includes(normalizedQuery)) &&
      (filters.lifecycle === 'all' || row.lifecycle === filters.lifecycle) &&
      (filters.draftState === 'all' || row.draftState === filters.draftState)
    ))
  }, [rows, filters])

  const columns: Array<DataTableColumn<AdminCollectionRecord>> = useMemo(() => [
    {
      key: 'title',
      header: 'Collection',
      label: 'Collection',
      width: 'minmax(12rem, 2fr)',
      cell: (collection) => (
        <Link
          className="ui-table__primary collections-workspace__title"
          href={`/admin/collections/collections/${collection.id}`}
        >
          {collection.title}
        </Link>
      ),
    },
    {
      key: 'lifecycle',
      header: 'Lifecycle',
      label: 'Lifecycle',
      cell: (collection) => <StatusPill status={collection.lifecycle} label={collection.lifecycle} />,
    },
    {
      key: 'draft',
      header: 'Draft',
      label: 'Draft',
      cell: (collection) => <StatusPill status={collection.draftState} label={collection.draftState} />,
    },
    {
      key: 'published',
      header: 'Published',
      label: 'Published',
      cell: (collection) => (
        <span className="ui-table__secondary">
          {collection.currentPublishedVersion ? `Version ${collection.currentPublishedVersion}` : 'Not published'}
        </span>
      ),
    },
    {
      key: 'members',
      header: 'Members',
      label: 'Members',
      align: 'end',
      cell: (collection) => (
        <span className="ui-chip-group">
          <Chip size="sm" tone="accent" title="Curations selected in the draft">{collection.draftSelectedCount.toLocaleString('en-US')} in draft</Chip>
          <Chip size="sm" title="Curations selected in the published version">{collection.publishedSelectedCount.toLocaleString('en-US')} published</Chip>
        </span>
      ),
    },
  ], [])

  async function createCollection(input: { title: string; slug: string; description: string | null }) {
    const created = await client.create(input)
    setRows((current) => [...current, created].sort((left, right) => left.title.localeCompare(right.title)))
    setCreating(false)
    navigate(`/admin/collections/collections/${created.id}`)
    return created
  }

  const openNewCollection = (
    <Button icon="plus" margin={false} onClick={() => setCreating(true)} type="button">
      New Collection
    </Button>
  )

  return (
    <AdminPage
      className="collections-workspace"
      eyebrow="Content"
      title="Collections"
      description="Build, review, version and publish curated sets without changing the source Curations."
      width="wide"
      actions={openNewCollection}
      sticky
    >
      <Toolbar label="Collection filters">
        <ToolbarGroup>
          <SearchInput
            label="Filter Collections"
            name="collections"
            onChange={(query) => setFilters((current) => ({ ...current, query }))}
            placeholder="Search by title"
            value={filters.query}
          />
          <SelectInput
            id="collections-lifecycle-filter"
            label="Lifecycle"
            onChange={(value) => setFilters((current) => ({ ...current, lifecycle: value as LifecycleFilter }))}
            options={LIFECYCLE_OPTIONS}
            value={filters.lifecycle}
          />
          <SelectInput
            id="collections-draft-state-filter"
            label="Draft state"
            onChange={(value) => setFilters((current) => ({ ...current, draftState: value as DraftStateFilter }))}
            options={DRAFT_STATE_OPTIONS}
            value={filters.draftState}
          />
        </ToolbarGroup>
        <ToolbarGroup end>
          {(filters.query.trim().length > 0 || filters.lifecycle !== 'all' || filters.draftState !== 'all') && (
            <Button
              buttonStyle="secondary"
              margin={false}
              onClick={() => setFilters(EMPTY_FILTERS)}
              size="small"
              type="button"
            >
              Clear filters
            </Button>
          )}
        </ToolbarGroup>
      </Toolbar>

      <ErrorBoundary title="The Collections list could not be displayed">
        {error ? (
          <ErrorState
            title="Collections could not load"
            description={error}
            onRetry={() => void reload()}
            retryLabel="Try again"
          />
        ) : (
          <DataTable
            caption="Collections"
            columns={columns}
            density="comfortable"
            empty={(
              <EmptyState
                title={rows.length === 0 ? 'No Collections yet' : 'No Collections match'}
                description={rows.length === 0
                  ? 'Create the first Collection to start packaging curated knowledge.'
                  : 'Change the current filters to broaden the result set.'}
                action={rows.length === 0
                  ? (
                    <Button icon="plus" margin={false} onClick={() => setCreating(true)} type="button">
                      Create Collection
                    </Button>
                  )
                  : (
                    <Button
                      buttonStyle="secondary"
                      margin={false}
                      onClick={() => setFilters(EMPTY_FILTERS)}
                      size="small"
                      type="button"
                    >
                      Clear filters
                    </Button>
                  )}
              />
            )}
            footer={(
              <span>
                {visible.length.toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')} Collections
              </span>
            )}
            loading={loading}
            rowKey={(collection) => collection.id}
            rows={visible}
            skeletonRows={6}
          />
        )}
      </ErrorBoundary>

      {creating && (
        <NewCollectionDialog
          onCancel={() => setCreating(false)}
          onCreate={createCollection}
        />
      )}
    </AdminPage>
  )
}
