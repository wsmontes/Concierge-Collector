'use client'

import type { ReactNode } from 'react'
import type { FieldNode } from '../../content/field-types'
import { isRecord } from '../../content/value-guards'
import { ContentFieldEditor } from '../content/ContentFieldEditor'
import { formatRelativeDate } from '../ui/format-relative-date'

/** Indentation step per tree depth, in pixels. */
const DEPTH_STEP = 14

/** Inline previews stay on one line: a longer value is clipped, never wrapped. */
const PREVIEW_LIMIT = 80

/**
 * Compact one-glance preview of a stored value. Dates read relative because
 * that is what an editor asks about an Entity; containers report their shape
 * instead of dumping their contents.
 */
export function describeValue(node: FieldNode): string {
  const value = node.value
  if (value === null) return 'null'
  if (value === undefined) return 'Not set'
  if (node.type === 'dateTime' && typeof value === 'string') return formatRelativeDate(value)
  if (Array.isArray(value)) return `${value.length} items`
  if (isRecord(value)) return `${Object.keys(value).length} fields`
  const text = String(value)
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text
}

/**
 * One field of a curated Entity section. It renders what the record stores,
 * opens the registry-driven editor on demand, and never offers an Edit
 * affordance for a system-managed field. The parent owns the edit state and
 * the save, so one field is edited at a time across the whole page.
 */
export function EntityFieldBlock({
  node,
  editingPath,
  onRequestEdit,
  onCommitValue,
  onCancelEdit,
}: {
  node: FieldNode
  editingPath: string | null
  onRequestEdit?: (node: FieldNode) => void
  onCommitValue?: (node: FieldNode, value: unknown) => void
  onCancelEdit?: () => void
}): ReactNode {
  const editing = editingPath === node.path
  const editable = node.editable && !node.system

  return (
    <li
      className="entity-field"
      data-path={node.path}
      data-owner={node.owner}
      style={{ paddingInlineStart: `${node.depth * DEPTH_STEP}px` }}
    >
      <div className="entity-field__head">
        <span className="entity-field__label">{node.label}</span>
        <span className="entity-field__path">{node.path}</span>
        <span className="entity-field__value">{describeValue(node)}</span>
        {node.descriptor === null && (
          <span className="entity-field__hint">Not in the field registry</span>
        )}
        {node.system && <span className="entity-field__system">System managed</span>}
        {editable && onRequestEdit !== undefined && !editing && (
          <button
            className="entity-field__edit"
            type="button"
            onClick={() => onRequestEdit(node)}
          >
            Edit
          </button>
        )}
      </div>
      {editing && onCommitValue !== undefined && onCancelEdit !== undefined && (
        <ContentFieldEditor
          node={node}
          onCommit={(value) => onCommitValue(node, value)}
          onCancel={onCancelEdit}
        />
      )}
    </li>
  )
}
