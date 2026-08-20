'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import type { AdminCurationRow } from '../../explorer/types'

export interface VirtualCurationTableProps {
  height: number
  isSelected?: (row: AdminCurationRow) => boolean
  onToggle?: (row: AdminCurationRow, index: number, shiftKey: boolean) => void
  onToggleAllLoaded?: (selectAll: boolean) => void
  rowHeight: number
  rows: readonly AdminCurationRow[]
  /** Header checkbox acts on the loaded range only; disabled while an all-matching intent is active. */
  selectAllDisabled?: boolean
}

/**
 * A viewport-sized DOM for large Curation result sets.
 *
 * The table container is keyboard-operable: ArrowUp/ArrowDown move the active
 * row, Space toggles it. Row checkboxes are removed from the tab order
 * (tabIndex -1) so Tab reaches exactly one table control; the header checkbox
 * reflects the loaded-range selection and supports the indeterminate state.
 */
export function VirtualCurationTable({
  height, isSelected, onToggle, onToggleAllLoaded, rowHeight, rows, selectAllDisabled = false,
}: VirtualCurationTableProps) {
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
    }
  }

  return (
    <div className="curation-table" ref={tableRef} role="table" aria-label="Curations" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="curation-table__header" role="row">
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
        <span role="columnheader">Curation</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">City</span>
        <span role="columnheader">Type</span>
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
                role="row"
                style={{ height: virtualRow.size, position: 'absolute', transform: `translateY(${virtualRow.start}px)`, width: '100%' }}
              >
                <span role="cell">
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
                <span role="cell">{row.restaurant_name ?? row.curation_id}</span>
                <span role="cell">{row.status}</span>
                <span role="cell">{row.city ?? '—'}</span>
                <span role="cell">{row.entity_type ?? '—'}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
