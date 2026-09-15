'use client'

import type { ReactNode } from 'react'
import type { ContentRecordKind, FieldDescriptor, FieldNode, FieldOwner } from '../../content/field-types'
import { buildFieldTree, declaredButAbsent, filterFieldTree, flattenFieldTree } from '../../content/record-inspector'
import { isRecord } from '../../content/value-guards'

/** Owner badge copy, keyed by the frozen owner vocabulary. */
const OWNER_LABEL: Record<FieldOwner, string> = {
  curation: 'Curation',
  entity: 'Entity',
  collection: 'Collection',
  system: 'System',
}

/** Indentation step per tree depth, in pixels. */
const DEPTH_STEP = 14

/** Inline previews stay on one line: a longer value is clipped, never wrapped. */
const PREVIEW_LIMIT = 80

/**
 * Compact one-glance preview. Missing values are named instead of hidden —
 * "the field exists and holds nothing" is exactly what the Inspector is for.
 */
function previewValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'empty'
  if (value instanceof Date) return value.toISOString()
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return `${value.byteLength} bytes`
  if (Array.isArray(value)) return `${value.length} items`
  if (isRecord(value)) return `${Object.keys(value).length} fields`
  const text = String(value)
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text
}

/**
 * The Inspector renders every field a record stores — registered or not —
 * and edits one field at a time. It owns neither the record nor the edit
 * state: `search` and `editingPath` arrive from the parent, which also
 * supplies the editor through `renderEditor`.
 */
export function ContentFieldInspector({
  record,
  kind,
  descriptors,
  label,
  search,
  onSearchChange,
  editingPath,
  onRequestEdit,
  onCommitValue,
  onCancelEdit,
  renderEditor,
}: {
  record: unknown
  kind: ContentRecordKind
  descriptors: readonly FieldDescriptor[]
  label: string
  search: string
  onSearchChange: (value: string) => void
  editingPath?: string | null
  onRequestEdit?: (node: FieldNode) => void
  onCommitValue?: (node: FieldNode, value: unknown) => void
  onCancelEdit?: () => void
  renderEditor?: (node: FieldNode, commit: (value: unknown) => void, cancel: () => void) => ReactNode
}): ReactNode {
  const tree = buildFieldTree(record, descriptors, kind)
  // Rows are flat and carry their own `depth`: the nested shape of the tree
  // reads as indentation, not as nested lists.
  const visibleNodes = flattenFieldTree(filterFieldTree(tree, search))
  // Compared against the whole tree, never the filtered one: a field that
  // holds no value cannot match a query, and search must not turn every
  // unrelated registered field into a false "declared but empty".
  const declared = declaredButAbsent(descriptors, tree)
  const hasQuery = search.trim().length > 0

  return (
    <section className="content-inspector" aria-label={label}>
      <h2 className="content-inspector__heading">{label}</h2>
      <input
        className="content-inspector__search"
        type="search"
        aria-label="Search fields"
        placeholder="Search fields or values..."
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      {visibleNodes.length > 0 && (
        <ul className="content-inspector__tree">
          {visibleNodes.map((node) => (
            <FieldRow
              key={node.path}
              node={node}
              editingPath={editingPath}
              onRequestEdit={onRequestEdit}
              onCommitValue={onCommitValue}
              onCancelEdit={onCancelEdit}
              renderEditor={renderEditor}
            />
          ))}
        </ul>
      )}
      {visibleNodes.length === 0 && (
        <p className="content-inspector__empty">
          {hasQuery ? `No fields match "${search.trim()}".` : 'This record has no fields.'}
        </p>
      )}
      {declared.length > 0 && (
        <section className="content-inspector__declared" aria-label="Declared but empty">
          <h3>Declared but empty</h3>
          <ul>
            {declared.map((descriptor) => (
              <li key={descriptor.path} className="content-inspector__row content-field">
                <span className="content-field__label">{descriptor.label}</span>
                <span className="content-field__path">{descriptor.path}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}

/** One field of the record: what it is, where it lives, what it holds. */
function FieldRow({
  node,
  editingPath,
  onRequestEdit,
  onCommitValue,
  onCancelEdit,
  renderEditor,
}: {
  node: FieldNode
  editingPath?: string | null
  onRequestEdit?: (node: FieldNode) => void
  onCommitValue?: (node: FieldNode, value: unknown) => void
  onCancelEdit?: () => void
  renderEditor?: (node: FieldNode, commit: (value: unknown) => void, cancel: () => void) => ReactNode
}) {
  const editing = editingPath === node.path
  const editable = node.editable && !node.system

  // The editor's protocol: report a new value or an abandoned edit. The
  // Inspector only forwards — the parent persists and closes the edit.
  function commitValue(value: unknown) {
    onCommitValue?.(node, value)
  }

  function cancelEdit() {
    onCancelEdit?.()
  }

  return (
    <li
      className="content-inspector__row content-field"
      data-owner={node.owner}
      style={{ paddingInlineStart: `${node.depth * DEPTH_STEP}px` }}
    >
      <span className="content-field__label">{node.label}</span>
      <span className="content-field__path">{node.path}</span>
      <span className="content-field__value">{previewValue(node.value)}</span>
      <span className="content-field__owner">{OWNER_LABEL[node.owner]}</span>
      {node.descriptor === null && (
        <span className="content-field__hint">Not in the field registry</span>
      )}
      {node.system && <span className="content-field__system">System managed</span>}
      {node.descriptor?.derivedFrom && (
        <span className="content-field__derived">Derived from {node.descriptor.derivedFrom}</span>
      )}
      {editable && !editing && (
        <span className="content-field__actions">
          <button type="button" onClick={() => onRequestEdit?.(node)}>
            Edit
          </button>
        </span>
      )}
      {editable && editing && renderEditor !== undefined && (
        <span className="content-field__actions">{renderEditor(node, commitValue, cancelEdit)}</span>
      )}
    </li>
  )
}
