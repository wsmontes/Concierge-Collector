'use client'

import { Button } from '@payloadcms/ui'
import type { KeyboardEvent, ReactNode } from 'react'
import type { FieldNode } from '../../../content/field-types'

/** Props every field editor receives from `ContentFieldEditor`. */
export interface FieldEditorProps {
  node: FieldNode
  onCommit: (value: unknown) => void
  onCancel: () => void
}

export interface EditorFrameProps {
  node: FieldNode
  onCancel: () => void
  /** Omitted by editors that commit without a Save button. */
  onSave?: () => void
  children: ReactNode
}

/**
 * Chrome of every field editor: the value slot plus the actions row. Escape
 * always abandons the edit.
 *
 * Rótulo, ajuda e erro NÃO moram aqui: quem os desenha é o primitivo do kit
 * (`Field`, `TextInput`, `SelectInput`, `CheckboxInput`) que envolve o controle.
 * Assim `htmlFor`, `aria-describedby`, `aria-invalid` e `role="alert"` têm um
 * dono só, em vez de cada editor reinstalar o vínculo — e o erro passa a usar o
 * tom de erro do tema, sem vermelho literal.
 */
export function EditorFrame({ node, onCancel, onSave, children }: EditorFrameProps): ReactNode {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onCancel()
  }

  return (
    <div className={`content-editor content-editor--${node.type}`} onKeyDown={handleKeyDown}>
      {children}
      <div className="content-editor__actions">
        <Button buttonStyle="secondary" margin={false} type="button" onClick={onCancel}>Cancel</Button>
        {onSave && <Button buttonStyle="primary" margin={false} type="button" onClick={onSave}>Save</Button>}
      </div>
    </div>
  )
}

/**
 * Vínculo que o `Field` do kit espera do seu controle, para os tipos que ele não
 * embrulha sozinho (textarea, `datetime-local`, decimal). Espelha o que
 * `ui/Field.tsx` faz internamente: mesmo `id`, mesmos sufixos de descrição/erro.
 */
export function controlAria(
  id: string,
  node: FieldNode,
  error?: string | null,
): { id: string; 'aria-describedby': string | undefined; 'aria-invalid': true | undefined } {
  return {
    id,
    'aria-describedby': node.descriptor?.help ? `${id}-description` : undefined,
    'aria-invalid': error ? true : undefined,
  }
}

/** Text-based editors start from what the record stores, never from nothing. */
export function textDraft(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}
