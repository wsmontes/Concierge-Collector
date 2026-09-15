'use client'

import { useId, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { EditorFrame, type FieldEditorProps } from './EditorFrame'

/** Pretty-prints whatever the record holds; a JSON editor must not hide data. */
function jsonDraft(value: unknown): string {
  if (value === undefined) return ''
  const text = JSON.stringify(value, null, 2)
  return text === undefined ? String(value) : text
}

/**
 * Last-resort editor for flexible data: objects, arrays, raw JSON and values
 * no screen was written for. Invalid JSON is reported and never committed.
 * Ctrl/Cmd+Enter saves without leaving the textarea.
 */
export function StructuredEditor({ node, onCommit, onCancel }: FieldEditorProps): ReactNode {
  const controlId = useId()
  const [draft, setDraft] = useState(() => jsonDraft(node.value))
  const [error, setError] = useState<string | null>(null)

  function save() {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft)
    } catch {
      setError('This value is not valid JSON.')
      return
    }
    setError(null)
    onCommit(parsed)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    save()
  }

  return (
    <EditorFrame node={node} controlId={controlId} error={error} onCancel={onCancel} onSave={save}>
      <textarea
        className="content-editor__input"
        id={controlId}
        rows={10}
        spellCheck={false}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setError(null)
        }}
        onKeyDown={handleKeyDown}
      />
    </EditorFrame>
  )
}
