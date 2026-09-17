'use client'

import { Button } from '@payloadcms/ui'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import type { AdminCollectionRecord } from '../../collections/admin-client'
import { Dialog } from '../ui/Dialog'
import { Field, TextareaInput } from '../ui/Field'
import { InlineNotice } from '../ui/InlineNotice'

export interface CollectionMetadataFormProps {
  collection: AdminCollectionRecord
  onCancel: () => void
  onSave: (input: { title: string; description: string | null }) => Promise<void>
}

/**
 * Metadata editing of one Collection: title and description, which is exactly
 * the pair the command accepts. The slug belongs to the record's identity and is
 * neither shown nor editable here.
 */
export function CollectionMetadataForm({ collection, onCancel, onSave }: CollectionMetadataFormProps) {
  const [title, setTitle] = useState(collection.title)
  const [description, setDescription] = useState(collection.description ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (pending) return
    const trimmedTitle = title.trim()
    if (trimmedTitle.length === 0) {
      setError('A Title is required.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await onSave({ title: trimmedTitle, description: description.trim() || null })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'request_failed')
    } finally {
      setPending(false)
    }
  }

  function onFieldKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void submit()
  }

  return (
    <Dialog
      description="The revision sent with the save is the one this Collection was loaded with, so a concurrent edit is refused instead of overwritten."
      footer={(
        <>
          <Button buttonStyle="secondary" disabled={pending} margin={false} onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button disabled={pending} margin={false} onClick={() => void submit()} type="button">
            {pending ? 'Saving…' : 'Save metadata'}
          </Button>
        </>
      )}
      onClose={() => { if (!pending) onCancel() }}
      open
      title="Edit Collection metadata"
    >
      <form
        className="collections-dialog-form"
        onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submit() }}
      >
        <Field htmlFor="collection-metadata-title" label="Title" required>
          <input
            autoFocus
            className="ui-input"
            id="collection-metadata-title"
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={onFieldKeyDown}
            required
            value={title}
          />
        </Field>
        <TextareaInput
          id="collection-metadata-description"
          label="Description"
          onChange={setDescription}
          rows={5}
          value={description}
        />
        {error && (
          <InlineNotice tone="error">
            <p>Unable to save metadata: {error}</p>
          </InlineNotice>
        )}
      </form>
    </Dialog>
  )
}
