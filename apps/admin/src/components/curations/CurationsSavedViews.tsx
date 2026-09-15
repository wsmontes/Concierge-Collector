'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { CurationColumnId } from '../../content/curation-columns'
import type { CurationSort } from '../../content/record-types'
import { createSavedCurationViewsClient, type SavedCurationView, type SavedCurationViewsClient } from '../../explorer/saved-views-client'
import type { NormalizedCurationFilters } from '../../explorer/types'

/**
 * Private views of the list. A view restores the query, the filters, the sort
 * and the visible columns — everything the operator had to set up by hand.
 */
export function CurationsSavedViews({
  currentFilters,
  currentSort,
  currentColumns,
  onApply,
  client,
}: {
  currentFilters: NormalizedCurationFilters
  currentSort: CurationSort
  currentColumns: readonly CurationColumnId[]
  onApply: (view: SavedCurationView) => void
  client?: SavedCurationViewsClient
}) {
  const api = useMemo(() => client ?? createSavedCurationViewsClient(), [client])
  const [views, setViews] = useState<SavedCurationView[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void api.list().then(
      (items) => {
        if (!active) return
        setViews(items)
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('Unable to load saved views.')
        setLoading(false)
      },
    )
    return () => { active = false }
  }, [api])

  function applySelected() {
    const selected = views.find((view) => view.id === selectedId)
    if (!selected) return
    onApply(selected)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedName = name.trim()
    if (!normalizedName || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await api.create(normalizedName, currentFilters, {
        sort: currentSort,
        visibleColumns: [...currentColumns],
      })
      setViews((current) => [created, ...current.filter((view) => view.id !== created.id)])
      setSelectedId(created.id)
      setName('')
    } catch {
      setError('Unable to save this view.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!selectedId || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await api.remove(selectedId)
      setViews((current) => current.filter((view) => view.id !== selectedId))
      setSelectedId('')
    } catch {
      setError('Unable to delete this view.')
    } finally {
      setDeleting(false)
    }
  }

  return <section className="curations-saved-views" aria-labelledby="saved-views-title">
    <div>
      <h2 id="saved-views-title">Saved views</h2>
      <p>Private shortcuts to the filters, sort and columns you keep coming back to.</p>
    </div>
    <div className="curations-saved-views__controls">
      <label>
        Saved view
        <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={loading || views.length === 0}>
          <option value="">{loading ? 'Loading…' : views.length === 0 ? 'No saved views' : 'Choose a view'}</option>
          {views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
        </select>
      </label>
      <button type="button" onClick={applySelected} disabled={!selectedId}>Apply saved view</button>
      <button type="button" onClick={() => void remove()} disabled={!selectedId || deleting}>Delete saved view</button>
    </div>
    <form onSubmit={save} className="curations-saved-views__save">
      <label>
        New view name
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
      </label>
      <button type="submit" disabled={!name.trim() || saving}>{saving ? 'Saving…' : 'Save current view'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
  </section>
}
