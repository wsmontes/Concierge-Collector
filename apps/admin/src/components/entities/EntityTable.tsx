'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import type { KeyboardEvent, ReactNode } from 'react'
import { useRef, useState } from 'react'
import type { EntityRow } from '../../content/record-types'
import { StatusPill } from '../ui/StatusPill'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'

export type EntityColumnId = 'entity' | 'type' | 'city' | 'status' | 'curations' | 'collections' | 'updated'

/** Column width vocabulary: the header and every row share one template. */
const COLUMN_WIDTH: Record<EntityColumnId, string> = {
  entity: 'minmax(16rem, 2.4fr)',
  type: 'minmax(7rem, 0.8fr)',
  city: 'minmax(9rem, 1fr)',
  status: 'minmax(7rem, 0.8fr)',
  curations: 'minmax(6rem, 0.6fr)',
  collections: 'minmax(6rem, 0.6fr)',
  updated: 'minmax(8rem, 0.9fr)',
}

/**
 * Default column set of the Entity list (plan §20).
 *
 * `Collections` counts the Collections holding any of the Entity's Curations:
 * the membership ledger lives on the Payload side, so the BFF joins it onto
 * the page (one ledger read per page) and the column renders whatever it
 * reports.
 */
const COLUMNS: readonly EntityColumnId[] = ['entity', 'type', 'city', 'status', 'curations', 'collections', 'updated']

/** `City` is derived from the stored `data`, never presented as canonical. */
const COLUMN_LABEL: Record<EntityColumnId, string> = {
  entity: 'Entity',
  type: 'Type',
  city: 'City (derived)',
  status: 'Status',
  curations: 'Curations',
  collections: 'Collections',
  updated: 'Updated',
}

export interface EntityTableProps {
  height: number
  /** Injected navigation, so the surface stays router-agnostic. */
  navigate: (href: string) => void
  onOpenRow: (row: EntityRow) => void
  rowHeight: number
  rows: readonly EntityRow[]
}

function timestampCell(value: string | null): ReactNode {
  if (!value) return '—'
  const absolute = formatAbsoluteDate(value)
  return <time dateTime={value} title={absolute ?? undefined}>{formatRelativeDate(value)}</time>
}

/**
 * The Entity's top-ranked image, at list size.
 *
 * A row without an image renders nothing rather than a frame: the list is for
 * scanning, and a broken/empty box per row would be noise. The image comes from
 * the Admin BFF (session cookie in, service key never out) and the route
 * defaults to the hero, so the list does not need to know a rank.
 *
 * No request is made for a row that is not rendered: the table is virtualized,
 * so off-screen rows are unmounted — and `loading="lazy"` covers the few that
 * are mounted just below the fold.
 */
function EntityRowThumb({ entityId }: { entityId: string }): ReactNode {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      className="entity-table__thumb"
      src={`/api/admin/v1/records/entities/${encodeURIComponent(entityId)}/image`}
      alt=""
      decoding="async"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

/** Name is the editorial identity; `entity_id` follows as secondary technical text. */
function identityCell(row: EntityRow): ReactNode {
  return (
    <span className="entity-table__identity">
      {row.entity_id && <EntityRowThumb entityId={row.entity_id} />}
      <span className="entity-table__text">
        <span className="entity-table__name">{row.name}</span>
        {row.entity_id && <span className="entity-table__technical">{row.entity_id}</span>}
      </span>
    </span>
  )
}

/**
 * A missing count is missing — never `0` and never blank. A non-zero count
 * links to the Entity record that holds the Curations.
 */
function curationsCell(row: EntityRow, navigate: (href: string) => void): ReactNode {
  if (row.curations_count === null) return '—'
  if (row.curations_count === 0) return '0'
  const href = `/admin/entities/${encodeURIComponent(row.id)}`
  return (
    <a
      className="entity-table__link"
      href={href}
      onClick={(event) => {
        // Opening the preview is the row's action; following this link is not.
        event.stopPropagation()
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(href)
      }}
    >
      {row.curations_count.toLocaleString()}
    </a>
  )
}

function cellFor(column: EntityColumnId, row: EntityRow, navigate: (href: string) => void): ReactNode {
  switch (column) {
    case 'entity':
      return identityCell(row)
    case 'type':
      return row.type || '—'
    case 'city':
      return row.city ?? '—'
    case 'status':
      return <StatusPill status={row.status} />
    case 'curations':
      return curationsCell(row, navigate)
    case 'collections':
      // Collections holding this Entity's Curations, joined by the BFF: `null`
      // is unknown and renders as an em dash; `0` is a real zero.
      return typeof row.collections_count === 'number' ? row.collections_count.toLocaleString() : '—'
    case 'updated':
      return timestampCell(row.updated_at)
  }
}

/**
 * A viewport-sized DOM for large Entity result sets.
 *
 * The table container is keyboard-operable: ArrowUp/ArrowDown move the active
 * row and Enter opens it. Rows are deliberately not selectable — bulk Entity
 * actions do not exist in this phase — so Tab reaches exactly one control.
 */
export function EntityTable({ height, navigate, onOpenRow, rowHeight, rows }: EntityTableProps) {
  const tableRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- virtualization deliberately owns scroll measurements.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    initialRect: { height, width: 1000 },
    overscan: 12,
  })
  // JSDOM and the first browser layout frame can report a zero scroll rect.
  // Render the first viewport-sized slice until the virtualizer measures it.
  const virtualItems = virtualizer.getVirtualItems()
  const visibleItems = virtualItems.length > 0
    ? virtualItems
    : rows.slice(0, Math.ceil(height / rowHeight) + 12).map((_, index) => ({ index, key: index, size: rowHeight, start: index * rowHeight }))

  const gridTemplateColumns = COLUMNS.map((column) => COLUMN_WIDTH[column]).join(' ')

  function moveActive(delta: number) {
    if (rows.length === 0) return
    // ArrowDown from no active row lands on the first row; ArrowUp on the last.
    const next = activeIndex === null
      ? (delta > 0 ? 0 : rows.length - 1)
      : Math.min(Math.max(activeIndex + delta, 0), rows.length - 1)
    setActiveIndex(next)
    virtualizer.scrollToIndex(next)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== tableRef.current) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActive(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(-1)
    } else if (event.key === 'Enter') {
      const row = rows[activeIndex ?? 0]
      if (row) {
        event.preventDefault()
        onOpenRow(row)
      }
    }
  }

  return (
    <div
      aria-label="Entities"
      className="entity-table"
      onKeyDown={handleKeyDown}
      ref={tableRef}
      role="table"
      tabIndex={0}
    >
      <div className="entity-table__header" role="row" style={{ gridTemplateColumns }}>
        {COLUMNS.map((column) => (
          <span data-column={column} key={column} role="columnheader">{COLUMN_LABEL[column]}</span>
        ))}
      </div>
      <div className="entity-table__viewport" ref={scrollRef} style={{ height, overflow: 'auto' }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {visibleItems.map((virtualRow) => {
            const row = rows[virtualRow.index]
            return (
              <div
                className="entity-table__row"
                data-active={activeIndex === virtualRow.index ? 'true' : undefined}
                data-index={virtualRow.index}
                key={row.id}
                onClick={() => onOpenRow(row)}
                role="row"
                style={{ gridTemplateColumns, height: virtualRow.size, position: 'absolute', transform: `translateY(${virtualRow.start}px)`, width: '100%' }}
              >
                {COLUMNS.map((column) => (
                  <span data-column={column} key={column} role="cell">{cellFor(column, row, navigate)}</span>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
