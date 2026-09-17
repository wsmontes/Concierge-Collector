'use client'

import { Button } from '@payloadcms/ui'
import type { ReactNode } from 'react'
import type { FieldNode } from '../../content/field-types'
import { ContentFieldEditor } from '../content/ContentFieldEditor'
import { CurationCopyButton } from './CurationCopyButton'
import { isBlank, isTechnicalName, isTimestampName, readableText, timestampLabels } from './curation-record-values'

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
  if (isBlank(node.value)) return <p className="ui-field-block__empty">Not set.</p>
  const text = readableText(node.value)
  if (variant === 'transcript') return <pre className="ui-field-block__transcript">{text}</pre>
  if (typeof node.value === 'string') {
    if (isTimestampName(node.path)) {
      const timestamp = timestampLabels(node.value)
      if (timestamp !== null) {
        return (
          <p className="ui-field-block__text">
            <time dateTime={node.value} title={timestamp.absolute ?? undefined}>{timestamp.relative}</time>
          </p>
        )
      }
    }
    // Technical values read in mono: an id, a hash or a path is compared
    // character by character, and the proportional face is the wrong instrument.
    return (
      <p className={`ui-field-block__text ${isTechnicalName(node.path) ? 'ui-detail-mono' : ''}`.trim()}>
        {text}
      </p>
    )
  }
  return <pre className="ui-field-block__json ui-detail-pre">{text}</pre>
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
    <div className="ui-field-block" data-path={node.path}>
      <div className="ui-field-block__header">
        <h3 className="ui-field-block__label">{node.label}</h3>
        {saving && <span className="ui-field-block__state" role="status">Saving…</span>}
        {node.editable && !editing && (
          <Button
            buttonStyle="secondary"
            disabled={edit.savingPath !== null}
            margin={false}
            onClick={() => edit.onEdit(node.path)}
            size="small"
            type="button"
          >
            Edit
          </Button>
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
