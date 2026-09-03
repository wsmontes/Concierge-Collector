'use client'

import { FormEvent, useState } from 'react'

export function IssueCredentialDialog({
  applicationName,
  pending,
  onClose,
  onIssue,
}: {
  applicationName: string
  pending: boolean
  onClose: () => void
  onIssue: (name: string) => Promise<void> | void
}) {
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    if (!name) {
      setError('Credential name is required.')
      return
    }
    setError(null)
    try {
      await onIssue(name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'request_failed')
    }
  }

  return <div className="collection-dialog-backdrop" role="presentation">
    <section aria-labelledby="issue-credential-title" aria-modal="true" className="collection-dialog" role="dialog">
      <header className="collection-dialog__header">
        <div>
          <p className="collection-views__eyebrow">Distribution</p>
          <h2 id="issue-credential-title">Issue credential</h2>
        </div>
        <button type="button" onClick={onClose} disabled={pending} aria-label="Close issue credential dialog">×</button>
      </header>
      <p>Create an individually revocable read credential for <strong>{applicationName}</strong>. Its secret will be shown only once.</p>
      <form onSubmit={submit}>
        <label>
          Credential name
          <input name="name" required maxLength={120} autoFocus disabled={pending} />
        </label>
        {error && <p role="alert">{error}</p>}
        <footer className="collection-dialog__footer">
          <button type="button" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" disabled={pending} aria-label="Issue credential now">
            {pending ? 'Issuing…' : 'Issue credential'}
          </button>
        </footer>
      </form>
    </section>
  </div>
}

export function CredentialActionDialog({
  action,
  credentialName,
  overlapHours,
  pending,
  onClose,
  onConfirm,
}: {
  action: 'rotate' | 'revoke'
  credentialName: string
  overlapHours: number
  pending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const rotate = action === 'rotate'
  const title = rotate ? 'Rotate credential' : 'Revoke credential'
  return <div className="collection-dialog-backdrop" role="presentation">
    <section aria-labelledby="credential-action-title" aria-modal="true" className="collection-dialog" role="dialog">
      <header className="collection-dialog__header">
        <h2 id="credential-action-title">{title}</h2>
      </header>
      <p>
        {rotate
          ? <>A new secret will be issued for <strong>{credentialName}</strong>. The current secret remains valid for {overlapHours} hours so the consumer can cut over safely.</>
          : <>Revoking <strong>{credentialName}</strong> takes effect on the next API request and cannot be undone. Issue a new credential if access is needed again.</>}
      </p>
      <footer className="collection-dialog__footer">
        <button type="button" onClick={onClose} disabled={pending}>Cancel</button>
        <button type="button" onClick={onConfirm} disabled={pending}>
          {pending ? (rotate ? 'Rotating…' : 'Revoking…') : rotate ? 'Confirm rotate' : 'Confirm revoke'}
        </button>
      </footer>
    </section>
  </div>
}
