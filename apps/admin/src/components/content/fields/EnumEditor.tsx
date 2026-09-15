'use client'

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { EditorFrame, textDraft, type FieldEditorProps } from './EditorFrame'

/**
 * Constrained vocabulary when the registry knows one, free text when it does
 * not — an enum whose values were never declared must stay editable.
 * The empty option stands for "no value" and commits `null`.
 */
export function EnumEditor({ node, onCommit, onCancel }: FieldEditorProps): ReactNode {
  const controlId = useId()
  const values = node.descriptor?.enumValues ?? []
  const [draft, setDraft] = useState(() => textDraft(node.value))

  function save() {
    onCommit(draft === '' ? null : draft)
  }

  return (
    <EditorFrame node={node} controlId={controlId} onCancel={onCancel} onSave={save}>
      {values.length > 0
        ? (
            <select
              className="content-editor__input"
              id={controlId}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            >
              <option value="" />
              {values.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          )
        : (
            <input
              className="content-editor__input"
              id={controlId}
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
    </EditorFrame>
  )
}
