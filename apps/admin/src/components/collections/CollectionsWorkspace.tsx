'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CollectionsAdminError,
  createBrowserCollectionsAdminClient,
  type AdminCollectionRecord,
  type CollectionsAdminClient,
} from '../../collections/admin-client'
import { NewCollectionDialog } from './NewCollectionDialog'

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
  client = createBrowserCollectionsAdminClient(),
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
    void reload()
  }, [reload])

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
    navigate(`/admin/collections/${created.id}`)
    return created
  }

  return (
    <main className="collections-workspace">
      <header className="collections-workspace__header">
        <div>
          <p className="collection-views__eyebrow">Content</p>
          <h1>Collections</h1>
          <p>Build, review, version and publish curated sets without changing the source Curations.</p>
        </div>
        <button type="button" onClick={() => setCreating(true)}>New Collection</button>
      </header>

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
        <div className="collections-workspace__error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void reload()}>Try again</button>
        </div>
      )}

      {loading ? (
        <p role="status">Loading Collections…</p>
      ) : visible.length === 0 ? (
        <p>No Collections match the current filters.</p>
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
                    <a href={`/admin/collections/${collection.id}`}>{collection.title}</a>
                    <span className="collections-workspace__slug">/{collection.slug}</span>
                  </td>
                  <td><span>{collection.lifecycle}</span></td>
                  <td><span>{collection.draftState}</span></td>
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
    </main>
  )
}
