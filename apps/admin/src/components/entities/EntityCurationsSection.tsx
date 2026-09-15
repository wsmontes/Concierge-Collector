'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { getFieldValue } from '../../content/field-path'
import { isRecord } from '../../content/value-guards'
import { EmptyState } from '../ui/EmptyState'
import { InlineNotice } from '../ui/InlineNotice'
import { StatusPill } from '../ui/StatusPill'
import { formatRelativeDate } from '../ui/format-relative-date'

/** Where the CURATIONS ABOUT THIS ENTITY block gets its rows. */
export interface EntityCurationsState {
  status: 'loading' | 'ready' | 'error'
  items: readonly Record<string, unknown>[]
  total: number
  error: string | null
}

/**
 * Primary label of a Curation: the curator's name — what the plan's Entity →
 * Curations list shows. A stored id is never the label; a nameless record is
 * named as such instead.
 */
function curationName(record: Record<string, unknown>): string {
  const curatorName = getFieldValue(record, 'curator.name')
  if (typeof curatorName === 'string' && curatorName.trim().length > 0) return curatorName
  const restaurantName = getFieldValue(record, 'restaurant_name')
  if (typeof restaurantName === 'string' && restaurantName.trim().length > 0) return restaurantName
  const publicNote = getFieldValue(record, 'notes.public')
  if (typeof publicNote === 'string' && publicNote.trim().length > 0) return publicNote
  return 'Untitled curation'
}

/**
 * Concept chips, read from the Curation's flexible `categories` map. Only
 * values the record stores become chips — an empty vocabulary stays empty.
 */
function conceptChips(record: Record<string, unknown>): string[] {
  const categories = getFieldValue(record, 'categories')
  if (!isRecord(categories)) return []
  const chips: string[] = []
  for (const key of Object.keys(categories)) {
    const entry = categories[key]
    if (Array.isArray(entry)) {
      for (const item of entry) {
        if (typeof item === 'string' && item.trim().length > 0) chips.push(item)
      }
      continue
    }
    if (typeof entry === 'string' && entry.trim().length > 0) chips.push(entry)
  }
  return chips
}

/** Full Curation route; the domain `curation_id` first, the stored id second. */
function curationHref(record: Record<string, unknown>): string | null {
  const curationId = getFieldValue(record, 'curation_id')
  if (typeof curationId === 'string' && curationId.length > 0) {
    return `/admin/curations/${encodeURIComponent(curationId)}`
  }
  const storedId = getFieldValue(record, '_id')
  if (typeof storedId === 'string' && storedId.length > 0) {
    return `/admin/curations/${encodeURIComponent(storedId)}`
  }
  return null
}

export function EntityCurationsSection({
  state,
  onNavigate,
}: {
  state: EntityCurationsState
  onNavigate?: (href: string) => void
}): ReactNode {
  if (state.status === 'loading') {
    return <p className="entity-curations__status" role="status">Loading Curations…</p>
  }

  if (state.status === 'error') {
    return (
      <InlineNotice tone="error">
        {state.error === null
          ? 'The Curations about this Entity could not be loaded.'
          : `The Curations about this Entity could not be loaded: ${state.error}`}
      </InlineNotice>
    )
  }

  if (state.items.length === 0) {
    return (
      <EmptyState
        title="No Curations about this Entity"
        description="No stored Curation points at this Entity yet."
      />
    )
  }

  return (
    <div className="entity-curations">
      <p className="entity-curations__total">
        {state.total} {state.total === 1 ? 'Curation' : 'Curations'}
      </p>
      <ul className="entity-curations__list">
        {state.items.map((record, index) => {
          const href = curationHref(record)
          const status = getFieldValue(record, 'status')
          const updated = getFieldValue(record, 'updatedAt')
          const chips = conceptChips(record)
          return (
            <li key={href ?? `curation-${index}`}>
              <article className="entity-curations__card">
                <h3 className="entity-curations__name">
                  {href === null
                    ? curationName(record)
                    : (
                        <Link
                          className="entity-curations__link"
                          href={href}
                          onClick={(event) => {
                            if (onNavigate === undefined) return
                            event.preventDefault()
                            onNavigate(href)
                          }}
                        >
                          {curationName(record)}
                        </Link>
                      )}
                </h3>
                <p className="entity-curations__meta">
                  {/* Legacy documents carry no curator_type: human is the default. */}
                  <span className="entity-curations__curator">
                    {getFieldValue(record, 'curator_type') === 'synthetic' ? 'Synthetic' : 'Human'}
                  </span>
                  {typeof status === 'string' && <StatusPill status={status} />}
                </p>
                {chips.length > 0 && (
                  <ul className="entity-curations__concepts">
                    {chips.map((chip, chipIndex) => (
                      <li className="entity-curations__concept" key={`${chip}-${chipIndex}`}>{chip}</li>
                    ))}
                  </ul>
                )}
                {typeof updated === 'string' && (
                  <p className="entity-curations__updated">Updated {formatRelativeDate(updated)}</p>
                )}
              </article>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
