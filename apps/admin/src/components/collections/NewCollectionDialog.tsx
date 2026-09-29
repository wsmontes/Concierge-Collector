'use client'

import { FormEvent, useState } from 'react'
import type { AdminCollectionRecord } from '../../collections/admin-client'

export interface NewCollectionDialogProps {
  onCancel: () => void
  onCreate: (input: { title: string; slug: string; description: string | null }) => Promise<AdminCollectionRecord>
}

export function NewCollectionDialog({ onCancel, onCreate }: NewCollectionDialogProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      await onCreate({
        title: String(form.get('title') ?? '').trim(),
        slug: String(form.get('slug') ?? '').trim(),
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
        aria-labelledby="new-collection-title"
        aria-modal="true"
        className="collection-dialog"
        role="dialog"
      >
        <header className="collection-dialog__header">
          <div>
            <p className="collection-views__eyebrow">Content</p>
            <h2 id="new-collection-title">New Collection</h2>
          </div>
          <button type="button" onClick={onCancel} disabled={pending} aria-label="Close New Collection dialog">×</button>
        </header>
        <form onSubmit={submit}>
          <label>
            Title
            <input name="title" required maxLength={160} autoFocus />
          </label>
          <label>
            Slug
            <input name="slug" required minLength={3} maxLength={80} autoCapitalize="none" spellCheck={false} />
          </label>
          <label>
            Description
            <textarea name="description" rows={4} />
          </label>
          {error && <p role="alert">Unable to create Collection: {error}</p>}
          <footer className="collection-dialog__footer">
            <button type="button" onClick={onCancel} disabled={pending}>Cancel</button>
            <button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create Collection'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
