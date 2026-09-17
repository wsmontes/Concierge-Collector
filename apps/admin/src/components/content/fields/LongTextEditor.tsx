'use client'

import { useId, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Field } from '../../ui/Field'
import { EditorFrame, controlAria, textDraft, type FieldEditorProps } from './EditorFrame'

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
    <EditorFrame node={node} onCancel={onCancel} onSave={() => onCommit(draft)}>
      <Field description={node.descriptor?.help} htmlFor={controlId} label={node.label}>
        <textarea
          {...controlAria(controlId, node)}
          className="ui-textarea"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={8}
          value={draft}
        />
      </Field>
    </EditorFrame>
  )
}
