'use client'

import { useId, useMemo, useState } from 'react'
import { filterFields, inspectRecord } from '../../content/record-inspector'
import type { FieldNode } from '../../content/record-inspector'
import { ContentFieldRow } from './ContentFieldRow'

export interface ContentFieldInspectorProps {
  kind: 'curation' | 'entity'
  record: unknown
  title?: string
}

/** Leaves are what an operator reads; containers only group them. */
function countFields(nodes: readonly FieldNode[]): number {
  return nodes.reduce((total, node) => total + node.leafCount, 0)
}

/**
 * Universal read surface for a raw CMS document: every stored field, including
 * ones no descriptor knows about, plus search over paths and values. Purely
 * presentational — the caller owns fetching and the record value.
 */
export function ContentFieldInspector({ kind, record, title }: ContentFieldInspectorProps) {
  const [search, setSearch] = useState('')
  const headingId = useId()
  const searchId = useId()

  const nodes = useMemo(() => inspectRecord(record, kind), [record, kind])
  const query = search.trim()
  const visible = useMemo(() => (query.length === 0 ? nodes : filterFields(nodes, query)), [nodes, query])
  const fieldCount = useMemo(() => countFields(visible), [visible])

  return (
    <section aria-labelledby={headingId} className="content-field-inspector">
      <h2 className="content-field-inspector__title" id={headingId}>{title ?? 'Record fields'}</h2>
      <div className="content-field-inspector__controls">
        <label htmlFor={searchId}>Search fields and values</label>
        <input
          id={searchId}
          onChange={(event) => setSearch(event.target.value)}
          type="search"
          value={search}
        />
        <p className="content-field-inspector__count">
          {fieldCount} {fieldCount === 1 ? 'field' : 'fields'}
        </p>
      </div>
      {record === null || record === undefined ? (
        <p role="status">No record loaded.</p>
      ) : visible.length === 0 ? (
        <p className="content-field-inspector__empty">
          {query.length === 0 ? 'This record has no fields.' : 'No fields match the current search.'}
        </p>
      ) : (
        <ul className="content-field-inspector__tree">
          {visible.map((node) => <ContentFieldRow key={node.path} node={node} revealMatches={query.length > 0} />)}
        </ul>
      )}
    </section>
  )
}
