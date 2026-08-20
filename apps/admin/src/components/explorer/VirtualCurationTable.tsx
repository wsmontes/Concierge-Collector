'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import type { AdminCurationRow } from '../../explorer/types'

export interface VirtualCurationTableProps {
  height: number
  isSelected?: (row: AdminCurationRow) => boolean
  onToggle?: (row: AdminCurationRow, index: number, shiftKey: boolean) => void
  rowHeight: number
  rows: readonly AdminCurationRow[]
}

/** A viewport-sized DOM for large Curation result sets. */
export function VirtualCurationTable({ height, isSelected, onToggle, rowHeight, rows }: VirtualCurationTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
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

  return (
    <div className="curation-table" role="table" aria-label="Curations">
      <div className="curation-table__header" role="row">
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
