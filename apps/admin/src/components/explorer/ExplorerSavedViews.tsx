'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createSavedCurationViewsClient, type SavedCurationViewsClient, type SavedCurationView } from '../../explorer/saved-views-client'
import type { NormalizedCurationFilters } from '../../explorer/types'

export function ExplorerSavedViews({
  currentFilters,
  onApply,
  client,
}: {
  currentFilters: NormalizedCurationFilters
  onApply: (filters: NormalizedCurationFilters) => void
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
    onApply(selected.normalizedFilters ?? {})
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedName = name.trim()
    if (!normalizedName || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await api.create(normalizedName, currentFilters)
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

  return <section className="explorer-saved-views" aria-labelledby="saved-views-title">
    <div>
      <h2 id="saved-views-title">Saved views</h2>
      <p>Private shortcuts to your currently applied Explorer filters.</p>
    </div>
    <div className="explorer-saved-views__controls">
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
    <form onSubmit={save} className="explorer-saved-views__save">
      <label>
        New view name
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
      </label>
      <button type="submit" disabled={!name.trim() || saving}>{saving ? 'Saving…' : 'Save current view'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
  </section>
}
