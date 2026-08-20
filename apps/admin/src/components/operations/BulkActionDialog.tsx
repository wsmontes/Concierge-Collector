'use client'

import { useEffect, useRef, useState } from 'react'

export interface CollectionOption {
  id: string
  slug: string
  title: string
  draftRevision: number
  draftState: string
  draftSelectedCount: number
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Picks target Collections for a ready server-side selection and posts the bulk
 * intent. The browser never expands the selection into curation IDs: the body
 * carries only collectionIds and the action; the manifest stays on the server.
 */
export function BulkActionDialog({
  selectionId,
  onClose,
  onPosted,
}: {
  selectionId: string
  onClose: () => void
  onPosted: (operationId: string) => void
}) {
  const [collections, setCollections] = useState<CollectionOption[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [action, setAction] = useState<'add' | 'remove'>('add')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const submittingRef = useRef(false)
  useEffect(() => { submittingRef.current = submitting }, [submitting])

  useEffect(() => {
    closeButton.current?.focus()
    const controller = new AbortController()
    void fetch('/api/admin/v1/collections', { credentials: 'same-origin', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('unable_to_load_collections')
        return response.json() as Promise<{ items: CollectionOption[] }>
      })
      .then((data) => setCollections(data.items))
      .catch((cause) => {
        if (controller.signal.aborted) return
        setError('Unable to load Collections. Try again.')
        void cause
      })
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !submittingRef.current) onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      controller.abort()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  function toggle(collectionId: string) {
    if (submitting) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(collectionId)) next.delete(collectionId)
      else next.add(collectionId)
      return next
    })
  }

  async function submit() {
    if (selected.size === 0 || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const body = { collectionIds: [...selected], action }
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'idempotency-key': newId(),
        'x-request-id': newId(),
      }
      if (selected.size === 1) {
        const only = collections.find((collection) => collection.id === [...selected][0])
        if (only) headers['if-match'] = String(only.draftRevision)
      }
      const response = await fetch(`/api/admin/v1/selections/${selectionId}/operations`, {
        method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify(body),
      })
      const data = await response.json() as { operationId?: string }
      if (!response.ok || !data.operationId) {
        if (response.status === 412) throw new Error('revision_changed')
        throw new Error('unable_to_start')
      }
      onPosted(data.operationId)
    } catch (cause) {
      setSubmitting(false)
      setError(cause instanceof Error && cause.message === 'revision_changed'
        ? 'A Collection changed on the server. Close and refresh before retrying.'
        : 'Unable to start the job. Try again.')
    }
  }

  return (
    <div className="bulk-dialog-backdrop" role="presentation">
      <section className="bulk-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-dialog-title">
        <header className="bulk-dialog__header">
          <h2 id="bulk-dialog-title">Apply selection to Collections</h2>
          <button ref={closeButton} type="button" onClick={onClose} disabled={submitting}>Close</button>
        </header>
        <p className="bulk-dialog__hint">The selection stays server-side — the browser only sends the target Collections and the action.</p>
        <fieldset className="bulk-dialog__action" disabled={submitting}>
          <legend>Action</legend>
          <label><input checked={action === 'add'} name="bulk-action" onChange={() => setAction('add')} type="radio" /> Add to draft</label>
          <label><input checked={action === 'remove'} name="bulk-action" onChange={() => setAction('remove')} type="radio" /> Remove from draft</label>
        </fieldset>
        <ul className="bulk-dialog__collections">
          {collections.map((collection) => (
            <li key={collection.id}>
              <label>
                <input
                  checked={selected.has(collection.id)}
                  disabled={submitting}
                  onChange={() => toggle(collection.id)}
                  type="checkbox"
                />
                <span className="bulk-dialog__collection-title">{collection.title}</span>
                <span className="bulk-dialog__collection-meta">
                  {collection.slug} · {collection.draftSelectedCount} in draft · rev {collection.draftRevision}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {error && <p role="alert">{error}</p>}
        <footer className="bulk-dialog__footer">
          <button
            disabled={selected.size === 0 || submitting}
            onClick={() => void submit()}
            type="button"
          >
            {submitting ? 'Starting job…' : `Apply to ${selected.size} Collection${selected.size === 1 ? '' : 's'}`}
          </button>
        </footer>
      </section>
    </div>
  )
}
