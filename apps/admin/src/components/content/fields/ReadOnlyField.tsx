'use client'

import type { ReactNode } from 'react'
import { EditorFrame, type FieldEditorProps } from './EditorFrame'

/** Renders a stored value no editor can write back. */
function readOnlyText(value: unknown): string {
  if (value === null || value === undefined) return 'Not set'
  if (value instanceof Uint8Array) return `${value.byteLength} bytes`
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  const text = JSON.stringify(value, null, 2)
  return text === undefined ? String(value) : text
}

/**
 * Read-only block for system-managed fields and for types the Admin has no
 * writer for. The value stays visible; Save never exists here.
 */
export function ReadOnlyField({ node, onCancel }: FieldEditorProps): ReactNode {
  return (
    <EditorFrame node={node} onCancel={onCancel}>
      <p className="content-editor__input">{readOnlyText(node.value)}</p>
      <p className="content-editor__hint">
        {node.system
          ? 'System-managed field: read-only in the Admin.'
          : 'No editor for this field type: read-only in the Admin.'}
      </p>
    </EditorFrame>
  )
}
