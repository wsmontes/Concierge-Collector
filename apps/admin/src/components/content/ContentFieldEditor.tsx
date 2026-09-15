'use client'

import type { ReactNode } from 'react'
import type { FieldNode } from '../../content/field-types'
import { BooleanEditor } from './fields/BooleanEditor'
import { DateTimeEditor } from './fields/DateTimeEditor'
import { EnumEditor } from './fields/EnumEditor'
import { LongTextEditor } from './fields/LongTextEditor'
import { NumberEditor } from './fields/NumberEditor'
import { ReadOnlyField } from './fields/ReadOnlyField'
import { StructuredEditor } from './fields/StructuredEditor'
import { TextEditor } from './fields/TextEditor'

export interface ContentFieldEditorProps {
  node: FieldNode
  onCommit: (value: unknown) => void
  onCancel: () => void
}

/**
 * Every stored value gets a control. Plain fields get their own editor; flexible
 * and unrecognized shapes fall back to the structured editor, and values nothing
 * may write stay read-only instead of disappearing.
 */
export function ContentFieldEditor({ node, onCommit, onCancel }: ContentFieldEditorProps): ReactNode {
  const editorProps = { node, onCommit, onCancel }

  switch (node.type) {
    case 'text':
      return <TextEditor {...editorProps} />
    case 'longText':
      return <LongTextEditor {...editorProps} />
    case 'number':
      return <NumberEditor {...editorProps} />
    case 'boolean':
      return <BooleanEditor {...editorProps} />
    case 'dateTime':
      return <DateTimeEditor {...editorProps} />
    case 'enum':
      return <EnumEditor {...editorProps} />
    case 'array':
    case 'object':
    case 'json':
    case 'unknown':
      return <StructuredEditor {...editorProps} />
    default:
      return <ReadOnlyField {...editorProps} />
  }
}
