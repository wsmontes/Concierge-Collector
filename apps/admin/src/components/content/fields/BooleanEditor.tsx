'use client'

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckboxInput } from '../../ui/Field'
import { EditorFrame, type FieldEditorProps } from './EditorFrame'

/** Toggle: a boolean has one bit to change, so it commits on click. */
export function BooleanEditor({ node, onCommit, onCancel }: FieldEditorProps): ReactNode {
  const controlId = useId()
  const [checked, setChecked] = useState(() => node.value === true)

  return (
    <EditorFrame node={node} onCancel={onCancel}>
      <CheckboxInput
        checked={checked}
        description={node.descriptor?.help}
        id={controlId}
        label={node.label}
        onChange={(next) => {
          setChecked(next)
          onCommit(next)
        }}
      />
    </EditorFrame>
  )
}
