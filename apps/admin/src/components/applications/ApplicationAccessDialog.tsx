'use client'

import { useState } from 'react'
import type { ApplicationRecord } from './ApplicationViews'
import { CollectionAccessPicker } from './CollectionAccessPicker'

export function ApplicationAccessDialog({
  application,
  onClose,
  onSave,
}: {
  application: ApplicationRecord
  onClose: () => void
  onSave: (input: { allowedCollectionIds: string[]; defaultRequestsPerMinute: number }) => Promise<void>
}) {
  const [collectionIds, setCollectionIds] = useState<string[]>(application.allowedCollectionIds)
  const [rate, setRate] = useState(application.defaultRequestsPerMinute)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (pending || !Number.isInteger(rate) || rate < 1 || rate > 100000) return
    setPending(true)
    setError(null)
    try {
      await onSave({ allowedCollectionIds: collectionIds, defaultRequestsPerMinute: rate })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'request_failed')
      setPending(false)
    }
  }

  return (
    <div className="application-access-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="application-access-dialog-title"
        aria-modal="true"
        className="application-access-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="collection-views__eyebrow">Distribution</p>
            <h2 id="application-access-dialog-title">Edit {application.name} access</h2>
          </div>
          <button type="button" disabled={pending} onClick={onClose}>Close</button>
        </header>

        <CollectionAccessPicker value={collectionIds} onChange={setCollectionIds} disabled={pending} />
        <label>
          Requests per minute
          <input
            type="number"
            min="1"
            max="100000"
            value={rate}
            disabled={pending}
            onChange={(event) => setRate(Number(event.target.value))}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={pending} onClick={onClose}>Cancel</button>
          <button type="button" disabled={pending || !Number.isInteger(rate) || rate < 1 || rate > 100000} onClick={() => void save()}>
            {pending ? 'Saving…' : 'Save access'}
          </button>
        </footer>
      </section>
    </div>
  )
}