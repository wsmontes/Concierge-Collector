'use client'

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { TextInput } from '../../ui/Field'
import { EditorFrame, textDraft, type FieldEditorProps } from './EditorFrame'

/** Single-line text: one input, Save commits the raw string. */
export function TextEditor({ node, onCommit, onCancel }: FieldEditorProps): ReactNode {
  const controlId = useId()
  const [draft, setDraft] = useState(() => textDraft(node.value))

  return (
    <EditorFrame node={node} onCancel={onCancel} onSave={() => onCommit(draft)}>
      <TextInput
        description={node.descriptor?.help}
        id={controlId}
        label={node.label}
        onChange={setDraft}
        value={draft}
      />
    </EditorFrame>
  )
}
