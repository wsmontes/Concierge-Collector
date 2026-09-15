'use client'

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { EditorFrame, type FieldEditorProps } from './EditorFrame'

/** Toggle: a boolean has one bit to change, so it commits on click. */
export function BooleanEditor({ node, onCommit, onCancel }: FieldEditorProps): ReactNode {
  const controlId = useId()
  const [checked, setChecked] = useState(() => node.value === true)

  return (
    <EditorFrame node={node} controlId={controlId} onCancel={onCancel}>
      <input
        className="content-editor__input"
        id={controlId}
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          setChecked(event.target.checked)
          onCommit(event.target.checked)
        }}
      />
    </EditorFrame>
  )
}
