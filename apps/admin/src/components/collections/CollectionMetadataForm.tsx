'use client'

import { FormEvent, useState } from 'react'
import type { AdminCollectionRecord } from '../../collections/admin-client'

export interface CollectionMetadataFormProps {
  collection: AdminCollectionRecord
  onCancel: () => void
  onSave: (input: { title: string; description: string | null }) => Promise<void>
}

export function CollectionMetadataForm({ collection, onCancel, onSave }: CollectionMetadataFormProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      await onSave({
        title: String(form.get('title') ?? '').trim(),
        description: String(form.get('description') ?? '').trim() || null,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'request_failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="collection-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="collection-metadata-title"
        aria-modal="true"
        className="collection-dialog"
        role="dialog"
      >
        <header className="collection-dialog__header">
          <div>
            <p className="collection-views__eyebrow">Collection</p>
            <h2 id="collection-metadata-title">Edit Collection metadata</h2>
          </div>
          <button type="button" onClick={onCancel} disabled={pending} aria-label="Close metadata editor">×</button>
        </header>
        <p><strong>Slug</strong> <code>/{collection.slug}</code></p>
        <form onSubmit={submit}>
          <label>
            Title
            <input name="title" required maxLength={160} defaultValue={collection.title} autoFocus />
          </label>
          <label>
            Description
            <textarea name="description" rows={5} defaultValue={collection.description ?? ''} />
          </label>
          {error && <p role="alert">Unable to save metadata: {error}</p>}
          <footer className="collection-dialog__footer">
            <button type="button" onClick={onCancel} disabled={pending}>Cancel</button>
            <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save metadata'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
