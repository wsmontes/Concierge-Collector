'use client'

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { SelectInput, TextInput } from '../../ui/Field'
import { EditorFrame, textDraft, type FieldEditorProps } from './EditorFrame'

/** A select needs a named empty row: a blank option is unreadable. */
const NO_VALUE = ''

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
    <EditorFrame node={node} onCancel={onCancel} onSave={save}>
      {values.length > 0
        ? (
            <SelectInput
              description={node.descriptor?.help}
              id={controlId}
              label={node.label}
              onChange={setDraft}
              options={[
                { label: 'No value', value: NO_VALUE },
                ...values.map((value) => ({ label: value, value })),
              ]}
              value={draft}
            />
          )
        : (
            <TextInput
              description={node.descriptor?.help}
              id={controlId}
              label={node.label}
              onChange={setDraft}
              value={draft}
            />
          )}
    </EditorFrame>
  )
}
