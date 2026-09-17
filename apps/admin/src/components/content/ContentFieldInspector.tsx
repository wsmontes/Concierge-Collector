'use client'

import { Button } from '@payloadcms/ui'
import type { ReactNode } from 'react'
import type { ContentRecordKind, FieldDescriptor, FieldNode, FieldOwner } from '../../content/field-types'
import { buildFieldTree, declaredButAbsent, filterFieldTree, flattenFieldTree } from '../../content/record-inspector'
import { isRecord } from '../../content/value-guards'
import { Chip } from '../ui/Chip'
import { NoValue } from '../ui/NoValue'
import { SearchInput } from '../ui/Toolbar'

/** Owner badge copy, keyed by the frozen owner vocabulary. */
const OWNER_LABEL: Record<FieldOwner, string> = {
  curation: 'Curation',
  entity: 'Entity',
  collection: 'Collection',
  system: 'System',
}

/**
 * Owner is the record family a field belongs to — a classification, not a
 * health state: `system` is the strongest claim here, never an error tone.
 */
const OWNER_TONE: Record<FieldOwner, 'accent' | 'info' | 'muted'> = {
  curation: 'accent',
  entity: 'info',
  collection: 'muted',
  system: 'muted',
}

/** Indentation step per tree depth, in pixels. */
const DEPTH_STEP = 14

/** Inline previews stay on one line: a longer value is clipped, never wrapped. */
const PREVIEW_LIMIT = 80

/**
 * Compact one-glance preview, or `null` when the field holds nothing — the
 * absent value is rendered as the no-value mark instead of a blank cell.
 */
function previewValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
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
      <div className="content-inspector__search">
        <SearchInput
          label="Search fields"
          name="inspector-fields"
          onChange={onSearchChange}
          placeholder="Search fields or values..."
          value={search}
        />
      </div>
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
  const preview = previewValue(node.value)

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
      {preview === null
        ? <span className="content-field__value"><NoValue /></span>
        : <span className="content-field__value">{preview}</span>}
      <Chip className="content-field__owner" size="sm" tone={OWNER_TONE[node.owner]}>
        {OWNER_LABEL[node.owner]}
      </Chip>
      {node.descriptor === null && (
        <span className="content-field__hint">Not in the field registry</span>
      )}
      {node.system && <span className="content-field__system">System managed</span>}
      {node.descriptor?.derivedFrom && (
        <span className="content-field__derived">Derived from {node.descriptor.derivedFrom}</span>
      )}
      {editable && !editing && (
        <span className="content-field__actions">
          <Button buttonStyle="secondary" margin={false} size="small" type="button" onClick={() => onRequestEdit?.(node)}>
            Edit
          </Button>
        </span>
      )}
      {editable && editing && renderEditor !== undefined && (
        <span className="content-field__actions">{renderEditor(node, commitValue, cancelEdit)}</span>
      )}
    </li>
  )
}
