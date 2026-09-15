'use client'

import { Button } from '@payloadcms/ui'
import type { KeyboardEvent, ReactNode } from 'react'
import type { FieldNode } from '../../../content/field-types'

/** Props every field editor receives from `ContentFieldEditor`. */
export interface FieldEditorProps {
  node: FieldNode
  onCommit: (value: unknown) => void
  onCancel: () => void
}

export interface EditorFrameProps {
  node: FieldNode
  /** Associates the label with its control. Read-only blocks leave it out. */
  controlId?: string
  /** Set while the draft cannot be committed; blocks nothing but the message. */
  error?: string | null
  onCancel: () => void
  /** Omitted by editors that commit without a Save button. */
  onSave?: () => void
  children: ReactNode
}

/**
 * Shared chrome of every field editor: label, value slot, registry help, error
 * slot and actions. Escape always abandons the edit.
 */
export function EditorFrame({ node, controlId, error, onCancel, onSave, children }: EditorFrameProps): ReactNode {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onCancel()
  }

  return (
    <div className={`content-editor content-editor--${node.type}`} onKeyDown={handleKeyDown}>
      {controlId
        ? <label className="content-field__label" htmlFor={controlId}>{node.label}</label>
        : <p className="content-field__label">{node.label}</p>}
      {children}
      {node.descriptor?.help && <p className="content-editor__hint">{node.descriptor.help}</p>}
      {error && <p className="content-editor__error" role="alert">{error}</p>}
      <div className="content-editor__actions">
        <Button buttonStyle="secondary" margin={false} type="button" onClick={onCancel}>Cancel</Button>
        {onSave && <Button buttonStyle="primary" margin={false} type="button" onClick={onSave}>Save</Button>}
      </div>
    </div>
  )
}

/** Text-based editors start from what the record stores, never from nothing. */
export function textDraft(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}
