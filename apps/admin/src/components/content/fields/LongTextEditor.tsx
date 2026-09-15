'use client'

import { useId, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { EditorFrame, textDraft, type FieldEditorProps } from './EditorFrame'

/** Free text (notes, transcripts): Ctrl/Cmd+Enter saves without leaving the field. */
export function LongTextEditor({ node, onCommit, onCancel }: FieldEditorProps): ReactNode {
  const controlId = useId()
  const [draft, setDraft] = useState(() => textDraft(node.value))

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    onCommit(draft)
  }

  return (
    <EditorFrame node={node} controlId={controlId} onCancel={onCancel} onSave={() => onCommit(draft)}>
      <textarea
        className="content-editor__input"
        id={controlId}
        rows={8}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
    </EditorFrame>
  )
}
