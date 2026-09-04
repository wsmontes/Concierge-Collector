'use client'

import { useEffect, useState } from 'react'
import type { PublishPreviewDto } from '../../collections/admin-client'

export interface PublishCollectionDialogProps {
  preview: PublishPreviewDto
  pending: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}

function versionTransition(preview: PublishPreviewDto) {
  return preview.currentPublishedVersion
    ? `Version ${preview.currentPublishedVersion} → Version ${preview.nextVersion}`
    : `First publish → Version ${preview.nextVersion}`
}

function changeLabel(count: number, singular: string) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : `${singular}s`}`
}

export function PublishCollectionDialog({
  preview,
  pending,
  error = null,
  onCancel,
  onConfirm,
}: PublishCollectionDialogProps) {
  const [confirmedUnavailable, setConfirmedUnavailable] = useState(preview.unavailableCount === 0)
  const needsUnavailableConfirmation = preview.unavailableCount > 0

  useEffect(() => {
    setConfirmedUnavailable(preview.unavailableCount === 0)
  }, [preview.unavailableCount, preview.draftRevision, preview.revision])

  return (
    <div className="collection-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="publish-collection-title"
        aria-modal="true"
        className="collection-dialog"
        role="dialog"
      >
        <header className="collection-dialog__header">
          <div>
            <p className="collection-views__eyebrow">Publication</p>
            <h2 id="publish-collection-title">Publish Collection</h2>
          </div>
          <button type="button" onClick={onCancel} disabled={pending} aria-label="Close publish dialog">×</button>
        </header>

        <p className="collection-dialog__version">{versionTransition(preview)}</p>
        <dl className="collection-dialog__summary">
          <div><dt>Draft revision</dt><dd>{preview.draftRevision}</dd></div>
          <div><dt>Selection</dt><dd>{preview.selectedCount.toLocaleString('en-US')} selected</dd></div>
          <div><dt>Draft additions</dt><dd>{changeLabel(preview.addCount, 'add')}</dd></div>
          <div><dt>Draft removals</dt><dd>{changeLabel(preview.removeCount, 'remove')}</dd></div>
          <div><dt>Availability</dt><dd>{preview.availableCount.toLocaleString('en-US')} available</dd></div>
          <div><dt>Unavailable</dt><dd>{preview.unavailableCount.toLocaleString('en-US')} unavailable</dd></div>
        </dl>

        {needsUnavailableConfirmation && (
          <label className="collection-dialog__confirmation">
            <input
              type="checkbox"
              checked={confirmedUnavailable}
              onChange={(event) => setConfirmedUnavailable(event.target.checked)}
            />
            Publish with {preview.unavailableCount.toLocaleString('en-US')} unavailable {preview.unavailableCount === 1 ? 'Curation' : 'Curations'}
          </label>
        )}

        <p className="collection-dialog__hint">
          Publishing freezes this draft membership as a new version. Curation and Entity content remain live.
        </p>
        {error && <p role="alert">{error}</p>}

        <footer className="collection-dialog__footer">
          <button type="button" onClick={onCancel} disabled={pending}>Cancel</button>
          <button
            type="button"
            aria-label="Publish Collection now"
            disabled={pending || !confirmedUnavailable}
            onClick={onConfirm}
          >
            {pending ? 'Publishing…' : 'Publish'}
          </button>
        </footer>
      </section>
    </div>
  )
}
