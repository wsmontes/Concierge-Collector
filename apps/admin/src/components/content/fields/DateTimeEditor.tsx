'use client'

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Field } from '../../ui/Field'
import { EditorFrame, controlAria, type FieldEditorProps } from './EditorFrame'

function pad(part: number): string {
  return String(part).padStart(2, '0')
}

/**
 * Stored ISO 8601 → the datetime-local controls' own local wall-clock text.
 * Nothing here assumes a timezone: the browser's offset applies on both ends.
 */
function dateTimeDraft(value: unknown): string {
  const date = value instanceof Date ? value : typeof value === 'string' && value.trim() !== '' ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Timestamps are stored as ISO 8601 and shown in the editor's own timezone. */
export function DateTimeEditor({ node, onCommit, onCancel }: FieldEditorProps): ReactNode {
  const controlId = useId()
  const [draft, setDraft] = useState(() => dateTimeDraft(node.value))
  const [error, setError] = useState<string | null>(null)

  function save() {
    if (draft === '') {
      setError(null)
      onCommit(null)
      return
    }
    const parsed = new Date(draft)
    if (Number.isNaN(parsed.getTime())) {
      setError('Enter a valid date and time.')
      return
    }
    setError(null)
    onCommit(parsed.toISOString())
  }

  return (
    <EditorFrame node={node} onCancel={onCancel} onSave={save}>
      <Field
        description={node.descriptor?.help}
        error={error ?? undefined}
        htmlFor={controlId}
        label={node.label}
      >
        <input
          {...controlAria(controlId, node, error)}
          className="ui-input"
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          type="datetime-local"
          value={draft}
        />
      </Field>
    </EditorFrame>
  )
}
