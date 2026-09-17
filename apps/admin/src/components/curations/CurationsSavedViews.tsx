'use client'

import { Button } from '@payloadcms/ui'
import { useEffect, useMemo, useState } from 'react'
import type { CurationColumnId } from '../../content/curation-columns'
import type { CurationSort } from '../../content/record-types'
import { createSavedCurationViewsClient, type SavedCurationView, type SavedCurationViewsClient } from '../../explorer/saved-views-client'
import type { NormalizedCurationFilters } from '../../explorer/types'
import { Dialog } from '../ui/Dialog'
import { Field } from '../ui/Field'
import { Menu, type MenuItemSpec } from '../ui/Menu'

/**
 * Private views of the list. A view restores the filters, the sort and the
 * visible columns — everything the operator had to set up by hand.
 *
 * A apresentação é um menu do kit: aplicar uma view é escolher um item, e
 * "Save current view…" abre o diálogo do nome (um menu não hospeda campo de
 * texto). O formato persistido continua sendo o de `saved-views-client`.
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
  const [appliedId, setAppliedId] = useState('')
  const [name, setName] = useState('')
  const [naming, setNaming] = useState(false)
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

  async function save() {
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
      setAppliedId(created.id)
      setName('')
      setNaming(false)
    } catch {
      setError('Unable to save this view.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(view: SavedCurationView) {
    if (deleting) return
    setDeleting(true)
    setError(null)
    try {
      await api.remove(view.id)
      setViews((current) => current.filter((entry) => entry.id !== view.id))
      setAppliedId((current) => (current === view.id ? '' : current))
    } catch {
      setError('Unable to delete this view.')
    } finally {
      setDeleting(false)
    }
  }

  const applied = views.find((view) => view.id === appliedId) ?? null
  const items: MenuItemSpec[] = [
    ...views.map((view) => ({
      label: view.name,
      hint: 'Apply',
      onSelect: () => {
        setAppliedId(view.id)
        onApply(view)
      },
    })),
    ...(loading ? [{ label: 'Saved views are loading', disabled: true }] : []),
    ...(!loading && views.length === 0 ? [{ label: 'No saved views yet', disabled: true }] : []),
    { separator: true },
    { label: 'Save current view…', disabled: saving, onSelect: () => setNaming(true) },
    ...(applied
      ? [{
        label: `Delete “${applied.name}”`,
        tone: 'danger' as const,
        disabled: deleting,
        onSelect: () => void remove(applied),
      }]
      : []),
  ]

  return <div className="curations-saved-views">
    <Menu
      items={items}
      label="Saved views"
      trigger={<span className="curations-control">Views</span>}
    />
    {error && <p className="curations-saved-views__error" role="alert">{error}</p>}
    <Dialog
      description="A view keeps the filters, the sort and the visible columns."
      footer={(
        <>
          <Button buttonStyle="secondary" margin={false} onClick={() => setNaming(false)} size="small" type="button">
            Cancel
          </Button>
          <Button disabled={!name.trim() || saving} margin={false} onClick={() => void save()} size="small" type="button">
            {saving ? 'Saving view…' : 'Save current view'}
          </Button>
        </>
      )}
      onClose={() => setNaming(false)}
      open={naming}
      title="Save current view"
    >
      <Field htmlFor="saved-view-name" label="New view name">
        <input
          className="ui-input"
          id="saved-view-name"
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
      </Field>
    </Dialog>
  </div>
}
