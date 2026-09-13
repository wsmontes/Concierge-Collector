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
import { EmptyState } from '../ui/EmptyState'
import { InlineNotice } from '../ui/InlineNotice'
import { StatusPill } from '../ui/StatusPill'
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

function versionLabel(collection: AdminCollectionRecord) {
  return collection.currentPublishedVersion ? `Version ${collection.currentPublishedVersion}` : 'Not published'
}

export function CollectionsWorkspace({
  client = browserCollectionsClient,
  navigate = defaultNavigate,
}: CollectionsWorkspaceProps) {
  const [rows, setRows] = useState<AdminCollectionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [lifecycle, setLifecycle] = useState<'all' | AdminCollectionRecord['lifecycle']>('all')
  const [draftState, setDraftState] = useState<'all' | AdminCollectionRecord['draftState']>('all')
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
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return rows.filter((row) => (
      (!normalizedQuery || `${row.title} ${row.slug}`.toLocaleLowerCase().includes(normalizedQuery)) &&
      (lifecycle === 'all' || row.lifecycle === lifecycle) &&
      (draftState === 'all' || row.draftState === draftState)
    ))
  }, [rows, query, lifecycle, draftState])

  async function createCollection(input: { title: string; slug: string; description: string | null }) {
    const created = await client.create(input)
    setRows((current) => [...current, created].sort((left, right) => left.title.localeCompare(right.title)))
    setCreating(false)
    navigate(`/admin/collections/collections/${created.id}`)
    return created
  }

  return (
    <AdminPage
      className="collections-workspace"
      eyebrow="Content"
      title="Collections"
      description="Build, review, version and publish curated sets without changing the source Curations."
      actions={(
        <Button icon="plus" margin={false} onClick={() => setCreating(true)} type="button">
          New Collection
        </Button>
      )}
    >
      <section className="collections-workspace__filters" aria-label="Collection filters">
        <label>
          Filter Collections
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" />
        </label>
        <label>
          Lifecycle
          <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value as typeof lifecycle)}>
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>
          Draft state
          <select value={draftState} onChange={(event) => setDraftState(event.target.value as typeof draftState)}>
            <option value="all">All</option>
            <option value="clean">Clean</option>
            <option value="dirty">Dirty</option>
            <option value="publishing">Publishing</option>
            <option value="failed">Failed</option>
          </select>
        </label>
      </section>

      {error && (
        <InlineNotice
          tone="error"
          action={(
            <Button buttonStyle="secondary" margin={false} onClick={() => void reload()} size="small" type="button">
              Try again
            </Button>
          )}
        >
          <p>{error}</p>
        </InlineNotice>
      )}

      {loading ? (
        <p role="status">Loading Collections…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? 'No Collections yet' : 'No Collections match'}
          description={rows.length === 0
            ? 'Create the first Collection to start packaging curated knowledge.'
            : 'Change the current filters to broaden the result set.'}
          action={rows.length === 0 ? (
            <Button icon="plus" margin={false} onClick={() => setCreating(true)} type="button">
              Create Collection
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="collections-workspace__table-wrap">
          <table className="collections-workspace__table">
            <thead>
              <tr>
                <th scope="col">Collection</th>
                <th scope="col">Lifecycle</th>
                <th scope="col">Draft</th>
                <th scope="col">Published</th>
                <th scope="col">Selected</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((collection) => (
                <tr key={collection.id}>
                  <td>
                    <Link href={`/admin/collections/collections/${collection.id}`}>{collection.title}</Link>
                    <span className="collections-workspace__slug">/{collection.slug}</span>
                  </td>
                  <td><StatusPill status={collection.lifecycle} label={collection.lifecycle} /></td>
                  <td><StatusPill status={collection.draftState} label={collection.draftState} /></td>
                  <td>{versionLabel(collection)}</td>
                  <td>{collection.draftSelectedCount.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <NewCollectionDialog
          onCancel={() => setCreating(false)}
          onCreate={createCollection}
        />
      )}
    </AdminPage>
  )
}
