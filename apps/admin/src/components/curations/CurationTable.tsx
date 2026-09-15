'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { curationColumn, type CurationColumnId } from '../../content/curation-columns'
import type { AdminCurationRow } from '../../explorer/types'
import { StatusPill } from '../ui/StatusPill'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'

/** Column width vocabulary: the header and every row share one template. */
const COLUMN_WIDTH: Record<CurationColumnId, string> = {
  curation: 'minmax(14rem, 2fr)',
  entity: 'minmax(8rem, 1fr)',
  curator: 'minmax(9rem, 1fr)',
  type: 'minmax(7rem, 0.75fr)',
  city: 'minmax(8rem, 0.9fr)',
  concepts: 'minmax(12rem, 1.4fr)',
  collections: 'minmax(6rem, 0.6fr)',
  state: 'minmax(7rem, 0.7fr)',
  updated: 'minmax(8rem, 0.9fr)',
  created: 'minmax(8rem, 0.9fr)',
  curation_id: 'minmax(12rem, 1.2fr)',
  source_count: '5rem',
  image_count: '5rem',
  audio_count: '5rem',
  has_transcript: '7rem',
  version: '5rem',
}

const SELECT_WIDTH = '2.5rem'
/** Concepts past this many become a single "+N" marker instead of chips. */
const CONCEPT_CHIP_LIMIT = 3

export interface CurationTableProps {
  columns: readonly CurationColumnId[]
  height: number
  isSelected?: (row: AdminCurationRow) => boolean
  /** A row click, or Enter on the active row, opens the preview. */
  onOpenRow?: (row: AdminCurationRow) => void
  onToggle?: (row: AdminCurationRow, index: number, shiftKey: boolean) => void
  onToggleAllLoaded?: (selectAll: boolean) => void
  rowHeight: number
  rows: readonly AdminCurationRow[]
  /** Header checkbox acts on the loaded range only; disabled while an all-matching intent is active. */
  selectAllDisabled?: boolean
}

function textCell(value: string | null | undefined): ReactNode {
  return value ?? '—'
}

function countCell(value: number | null | undefined): ReactNode {
  return typeof value === 'number' ? value.toLocaleString() : '—'
}

function timestampCell(value: string | null | undefined): ReactNode {
  if (!value) return '—'
  const absolute = formatAbsoluteDate(value)
  return <time dateTime={value} title={absolute ?? undefined}>{formatRelativeDate(value)}</time>
}

function conceptCell(values: readonly string[] | null | undefined): ReactNode {
  if (!values || values.length === 0) return '—'
  const visible = values.slice(0, CONCEPT_CHIP_LIMIT)
  const hidden = values.length - visible.length
  return (
    <span className="curation-table__chips">
      {visible.map((value) => <span className="curation-table__chip" key={value}>{value}</span>)}
      {hidden > 0 && <span className="curation-table__chip curation-table__chip--more">{`+${hidden}`}</span>}
    </span>
  )
}

/** One cell per configured column. A field the row does not carry renders as missing. */
function cellFor(column: CurationColumnId, row: AdminCurationRow): ReactNode {
  switch (column) {
    case 'curation':
      return (
        <span className="curation-table__identity">
          <span className="curation-table__name">{row.restaurant_name ?? row.curation_id}</span>
          <StatusPill status={row.status} />
        </span>
      )
    case 'entity':
      return textCell(row.entity_type)
    case 'curator':
      return textCell(row.curator_name ?? row.curator_id)
    case 'type':
      return textCell(row.entity_type)
    case 'city':
      return textCell(row.city)
    case 'concepts':
      return conceptCell(row.concepts)
    case 'collections':
      return countCell(row.collections_count)
    case 'state':
      return row.status
    case 'updated':
      return timestampCell(row.updated_at)
    case 'created':
      return timestampCell(row.created_at)
    case 'curation_id':
      return row.curation_id
    case 'source_count':
      return countCell(row.source_count)
    case 'image_count':
      return countCell(row.image_count)
    case 'audio_count':
      return countCell(row.audio_count)
    case 'has_transcript':
      return typeof row.has_transcript === 'boolean' ? (row.has_transcript ? 'Yes' : 'No') : '—'
    case 'version':
      return typeof row.version === 'number' ? String(row.version) : '—'
  }
}

/**
 * A viewport-sized DOM for large Curation result sets.
 *
 * The table container is keyboard-operable: ArrowUp/ArrowDown move the active
 * row, Space toggles it, Enter opens it. Row checkboxes are removed from the
 * tab order (tabIndex -1) so Tab reaches exactly one table control; the header
 * checkbox reflects the loaded-range selection and supports the indeterminate
 * state. Selecting a row must never be confused with opening it, so the
 * checkbox cell stops the click that would otherwise open the preview.
 */
export function CurationTable({
  columns, height, isSelected, onOpenRow, onToggle, onToggleAllLoaded, rowHeight, rows, selectAllDisabled = false,
}: CurationTableProps) {
  const tableRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)
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

  const selectedCount = rows.reduce((count, row) => count + (isSelected?.(row) ? 1 : 0), 0)
  const someLoadedSelected = selectedCount > 0 && selectedCount < rows.length
  const allLoadedSelected = rows.length > 0 && selectedCount === rows.length

  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someLoadedSelected
  }, [someLoadedSelected])

  const gridTemplateColumns = `${SELECT_WIDTH} ${columns.map((column) => COLUMN_WIDTH[column]).join(' ')}`

  function moveActive(delta: number) {
    if (rows.length === 0) return
    // ArrowDown from no active row lands on the first row; ArrowUp on the last.
    const next = activeIndex === null
      ? (delta > 0 ? 0 : rows.length - 1)
      : Math.min(Math.max(activeIndex + delta, 0), rows.length - 1)
    setActiveIndex(next)
    virtualizer.scrollToIndex(next)
  }

  /** Table-level shortcuts fire only while the table itself holds focus (not a nested checkbox). */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== tableRef.current) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActive(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(-1)
    } else if (event.key === ' ') {
      const index = activeIndex ?? 0
      const row = rows[index]
      if (row) {
        event.preventDefault()
        onToggle?.(row, index, false)
      }
    } else if (event.key === 'Enter') {
      const row = rows[activeIndex ?? 0]
      if (row) {
        event.preventDefault()
        onOpenRow?.(row)
      }
    }
  }

  return (
    <div className="curation-table" ref={tableRef} role="table" aria-label="Curations" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="curation-table__header" role="row" style={{ gridTemplateColumns }}>
        <span role="columnheader">
          <input
            aria-label="Select all loaded Curations"
            checked={allLoadedSelected}
            disabled={selectAllDisabled || rows.length === 0}
            onChange={(event) => onToggleAllLoaded?.(event.target.checked)}
            ref={headerCheckboxRef}
            type="checkbox"
          />
        </span>
        {columns.map((column) => (
          <span data-column={column} key={column} role="columnheader">{curationColumn(column).label}</span>
        ))}
      </div>
      <div className="curation-table__viewport" ref={scrollRef} style={{ height, overflow: 'auto' }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {visibleItems.map((virtualRow) => {
            const row = rows[virtualRow.index]
            return (
              <div
                className="curation-table__row"
                data-active={activeIndex === virtualRow.index ? 'true' : undefined}
                data-index={virtualRow.index}
                key={row.curation_id}
                onClick={() => onOpenRow?.(row)}
                role="row"
                style={{ gridTemplateColumns, height: virtualRow.size, position: 'absolute', transform: `translateY(${virtualRow.start}px)`, width: '100%' }}
              >
                <span className="curation-table__select" onClick={(event) => event.stopPropagation()} role="cell">
                  <input
                    aria-label={`Select ${row.restaurant_name ?? row.curation_id}`}
                    checked={isSelected?.(row) ?? false}
                    onChange={(event) => onToggle?.(
                      row,
                      virtualRow.index,
                      'shiftKey' in event.nativeEvent && Boolean(event.nativeEvent.shiftKey),
                    )}
                    tabIndex={-1}
                    type="checkbox"
                  />
                </span>
                {columns.map((column) => (
                  <span data-column={column} key={column} role="cell">{cellFor(column, row)}</span>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
