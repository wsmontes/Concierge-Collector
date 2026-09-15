'use client'

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { EditorFrame, textDraft, type FieldEditorProps } from './EditorFrame'

/** Single-line text: one input, Save commits the raw string. */
export function TextEditor({ node, onCommit, onCancel }: FieldEditorProps): ReactNode {
  const controlId = useId()
  const [draft, setDraft] = useState(() => textDraft(node.value))

  return (
    <EditorFrame node={node} controlId={controlId} onCancel={onCancel} onSave={() => onCommit(draft)}>
      <input
        className="content-editor__input"
        id={controlId}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </EditorFrame>
  )
}
