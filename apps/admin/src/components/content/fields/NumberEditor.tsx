'use client'

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { EditorFrame, type FieldEditorProps } from './EditorFrame'

/**
 * `numberDraft` keeps a stored string/number visible; anything else starts empty.
 */
function numberDraft(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return typeof value === 'string' ? value : ''
}

/**
 * Numeric input. A `number` input would refuse the keystrokes before the editor
 * can explain itself, so this is a text input that parses on save.
 */
export function NumberEditor({ node, onCommit, onCancel }: FieldEditorProps): ReactNode {
  const controlId = useId()
  const [draft, setDraft] = useState(() => numberDraft(node.value))
  const [error, setError] = useState<string | null>(null)

  function save() {
    const text = draft.trim()
    if (text === '') {
      setError(null)
      onCommit(null)
      return
    }
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) {
      setError('Enter a number.')
      return
    }
    setError(null)
    onCommit(parsed)
  }

  return (
    <EditorFrame node={node} controlId={controlId} error={error} onCancel={onCancel} onSave={save}>
      <input
        className="content-editor__input"
        id={controlId}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setError(null)
        }}
      />
    </EditorFrame>
  )
}
