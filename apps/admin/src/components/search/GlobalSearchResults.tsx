'use client'

import type { ReactNode } from 'react'
import { searchOptionId, type SearchGroup, type SearchRow } from './search-rows'

export interface GlobalSearchResultsProps {
  groups: readonly SearchGroup[]
  /** The row index the keyboard currently owns, in flattened reading order. */
  activeIndex: number
  onOpen: (row: SearchRow) => void
}

/**
 * The palette's result list: one ARIA group per populated record family, each
 * row led by its human label with the id demoted to detail. Options stay
 * unfocusable on purpose — the pattern is `aria-activedescendant` on the input,
 * so arrow keys never move focus out of the field.
 */
export function GlobalSearchResults({ groups, activeIndex, onOpen }: GlobalSearchResultsProps): ReactNode {
  return (
    <div className="search-palette__results" id="global-search-results" role="listbox" aria-label="Search results">
      {groups.map((group) => {
        const headingId = `global-search-group-${group.kind}`
        return (
          <section className="search-palette__group" key={group.kind} role="group" aria-labelledby={headingId}>
            <h3 className="search-palette__group-title" id={headingId}>{group.title}</h3>
            {group.rows.map((row) => {
              const active = row.index === activeIndex
              return (
                <div
                  className={`search-palette__row${active ? ' search-palette__row--active' : ''}`}
                  id={searchOptionId(row.index)}
                  key={row.key}
                  role="option"
                  aria-selected={active}
                  onClick={() => onOpen(row)}
                >
                  <span className="search-palette__row-label">{row.label}</span>
                  <span className="search-palette__row-detail">
                    {row.meta && <span className="search-palette__row-meta">{row.meta}</span>}
                    <code className="search-palette__row-id">{row.id}</code>
                  </span>
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
