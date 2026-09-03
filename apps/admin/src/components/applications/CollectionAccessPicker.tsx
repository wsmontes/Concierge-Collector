'use client'

import { useEffect, useMemo, useState } from 'react'

export interface DistributionCollectionOption {
  id: string
  slug: string
  title: string
  lifecycle: 'draft' | 'published' | 'archived'
  currentPublishedVersion: number | null
}

export type LoadDistributionCollections = () => Promise<DistributionCollectionOption[]>

async function browserLoadCollections(): Promise<DistributionCollectionOption[]> {
  const response = await fetch('/api/admin/v1/collections', { credentials: 'same-origin' })
  if (!response.ok) throw new Error('unable_to_load_collections')
  const body = await response.json() as { items: DistributionCollectionOption[] }
  return body.items
}

function selectable(collection: DistributionCollectionOption, selected: boolean): boolean {
  // Existing access can always be removed even if the Collection has since
  // been archived. New grants require an actually published Collection.
  return selected || (collection.lifecycle === 'published' && collection.currentPublishedVersion !== null)
}

export function CollectionAccessPicker({
  value,
  onChange,
  disabled = false,
  loadCollections = browserLoadCollections,
}: {
  value: readonly string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  loadCollections?: LoadDistributionCollections
}) {
  const [collections, setCollections] = useState<DistributionCollectionOption[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const selected = useMemo(() => new Set(value), [value])

  useEffect(() => {
    let active = true
    void loadCollections().then(
      (items) => {
        if (!active) return
        setCollections(items)
        setError(null)
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('Unable to load Collections.')
        setLoading(false)
      },
    )
    return () => { active = false }
  }, [loadCollections])

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return collections
    return collections.filter((collection) => `${collection.title} ${collection.slug}`.toLocaleLowerCase().includes(normalized))
  }, [collections, query])

  function toggle(collection: DistributionCollectionOption) {
    const isSelected = selected.has(collection.id)
    if (disabled || !selectable(collection, isSelected)) return
    const next = new Set(selected)
    if (isSelected) next.delete(collection.id)
    else next.add(collection.id)
    onChange([...next])
  }

  return (
    <section className="collection-access-picker" aria-label="Collection access">
      <label>
        Find Collections
        <input
          disabled={disabled}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {loading && <p role="status">Loading Collections…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && visible.length === 0 && <p>No Collections match.</p>}
      <ul className="collection-access-picker__list">
        {visible.map((collection) => {
          const checked = selected.has(collection.id)
          const canSelect = selectable(collection, checked)
          return (
            <li key={collection.id}>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || !canSelect}
                  onChange={() => toggle(collection)}
                />
                <span>
                  <strong>{collection.title}</strong>
                  <small>
                    /{collection.slug} · {collection.lifecycle}
                    {collection.currentPublishedVersion ? ` · version ${collection.currentPublishedVersion}` : ' · not published'}
                    {!canSelect ? ' · unavailable for new access' : ''}
                  </small>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </section>
  )
}