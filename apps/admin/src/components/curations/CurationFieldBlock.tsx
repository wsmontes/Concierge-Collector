'use client'

import type { ReactNode } from 'react'
import type { FieldNode } from '../../content/field-types'
import { ContentFieldEditor } from '../content/ContentFieldEditor'
import { CurationCopyButton } from './CurationCopyButton'
import { isBlank, readableText } from './curation-record-values'

/**
 * The edit protocol a block-order section shares with the workspace. The
 * workspace owns the record and the open editor — a section only reports the
 * intent, which is what keeps "the same save path" true for every surface.
 */
export interface CurationSectionEditProps {
  editingPath: string | null
  savingPath: string | null
  onEdit: (path: string) => void
  onCancel: () => void
  onCommit: (node: FieldNode, value: unknown) => void
}

/** `transcript` is the one value that gets a reading area instead of a line. */
export type CurationFieldVariant = 'default' | 'transcript'

function FieldReadView({ node, variant }: { node: FieldNode; variant: CurationFieldVariant }): ReactNode {
  if (isBlank(node.value)) return <p className="curation-field__empty">Not set.</p>
  const text = readableText(node.value)
  if (variant === 'transcript') return <pre className="curation-field__transcript">{text}</pre>
  if (typeof node.value === 'string') return <p className="curation-field__text">{text}</p>
  return <pre className="curation-field__json">{text}</pre>
}

/**
 * One block of the record in read mode, turned into a form only when the reader
 * asks for it (plan §32). Editing is a property of the node, never re-derived
 * here: the field tree already answered whether a value may be written.
 */
export function CurationFieldBlock({
  node,
  edit,
  variant = 'default',
}: {
  node: FieldNode
  edit: CurationSectionEditProps
  variant?: CurationFieldVariant
}): ReactNode {
  const editing = edit.editingPath === node.path
  const saving = edit.savingPath === node.path

  function commit(value: unknown) {
    edit.onCommit(node, value)
  }

  return (
    <div className="curation-field" data-path={node.path}>
      <div className="curation-field__header">
        <h3 className="curation-field__label">{node.label}</h3>
        {saving && <span role="status">Saving…</span>}
        {node.editable && !editing && (
          <button
            className="curation-field__edit"
            type="button"
            disabled={edit.savingPath !== null}
            onClick={() => edit.onEdit(node.path)}
          >
            Edit
          </button>
        )}
      </div>
      {editing
        ? <ContentFieldEditor node={node} onCommit={commit} onCancel={edit.onCancel} />
        : <FieldReadView node={node} variant={variant} />}
      {!editing && variant === 'transcript' && !isBlank(node.value) && (
        <CurationCopyButton text={readableText(node.value)} label="Copy transcript" />
      )}
    </div>
  )
}
