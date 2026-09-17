'use client'

import { Button } from '@payloadcms/ui'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import type { AdminCollectionRecord } from '../../collections/admin-client'
import { Dialog } from '../ui/Dialog'
import { Field, TextareaInput } from '../ui/Field'
import { InlineNotice } from '../ui/InlineNotice'

export interface NewCollectionDialogProps {
  onCancel: () => void
  onCreate: (input: { title: string; slug: string; description: string | null }) => Promise<AdminCollectionRecord>
}

/**
 * Creating a Collection is a create command, so the dialog states exactly what
 * will be sent and reports the failure inside itself instead of closing and
 * leaving the list to guess. The shell is the kit `Dialog` (Payload `Modal`):
 * focus trap, `Esc` and click-outside come from it, and the previous hand-rolled
 * backdrop is gone.
 */
export function NewCollectionDialog({ onCancel, onCreate }: NewCollectionDialogProps) {
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (pending) return
    const trimmedTitle = title.trim()
    const trimmedSlug = slug.trim()
    // A validação vive aqui porque o rodapé é o botão do diálogo, não o
    // `submit` nativo do formulário: sem ela, um clique com campo vazio
    // enviaria um slug vazio ao BFF.
    if (trimmedTitle.length === 0) {
      setError('A Title is required.')
      return
    }
    if (trimmedSlug.length < 3) {
      setError('A Slug of at least 3 characters is required.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await onCreate({ title: trimmedTitle, slug: trimmedSlug, description: description.trim() || null })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'request_failed')
    } finally {
      setPending(false)
    }
  }

  function onFieldKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void submit()
  }

  return (
    <Dialog
      description="A Collection packages Curations for distribution without changing the source records."
      footer={(
        <>
          <Button buttonStyle="secondary" disabled={pending} margin={false} onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button disabled={pending} margin={false} onClick={() => void submit()} type="button">
            {pending ? 'Creating…' : 'Create Collection'}
          </Button>
        </>
      )}
      onClose={() => { if (!pending) onCancel() }}
      open
      title="New Collection"
    >
      <form
        className="collections-dialog-form"
        onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submit() }}
      >
        <Field htmlFor="new-collection-title" label="Title" required>
          <input
            autoFocus
            className="ui-input"
            id="new-collection-title"
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={onFieldKeyDown}
            required
            value={title}
          />
        </Field>
        <Field
          description="Lowercase and hyphenated identifier."
          htmlFor="new-collection-slug"
          label="Slug"
          required
        >
          <input
            autoCapitalize="none"
            className="ui-input ui-table__mono"
            id="new-collection-slug"
            maxLength={80}
            minLength={3}
            onChange={(event) => setSlug(event.target.value)}
            onKeyDown={onFieldKeyDown}
            required
            spellCheck={false}
            value={slug}
          />
        </Field>
        <TextareaInput
          id="new-collection-description"
          label="Description"
          onChange={setDescription}
          rows={4}
          value={description}
        />
        {error && (
          <InlineNotice tone="error">
            <p>Unable to create Collection: {error}</p>
          </InlineNotice>
        )}
      </form>
    </Dialog>
  )
}
