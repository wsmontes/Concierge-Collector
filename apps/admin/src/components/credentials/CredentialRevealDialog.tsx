'use client'

import { useEffect, useRef } from 'react'

export interface IssuedCredential {
  id: string
  name: string
  prefix: string
}

/** A deliberately ephemeral secret view: closing it removes its only UI copy. */
export function CredentialRevealDialog({
  credential,
  secretOnce,
  onClose,
}: {
  credential: IssuedCredential
  secretOnce: string
  onClose: () => void
}) {
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="credential-dialog-backdrop" role="presentation">
      <section className="credential-dialog" role="dialog" aria-modal="true" aria-labelledby="credential-reveal-title">
        <h2 id="credential-reveal-title">Save this credential now</h2>
        <p><strong>{credential.name}</strong> ({credential.prefix}) is shown only once. Closing this window permanently removes it from the admin interface.</p>
        <code aria-label="Credential secret" className="credential-dialog__secret">{secretOnce}</code>
        <p>Store it in your application’s secret manager. If it is lost, issue a replacement and revoke this credential.</p>
        <button ref={closeButton} type="button" onClick={onClose}>I saved it</button>
      </section>
    </div>
  )
}
