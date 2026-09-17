'use client'

import { Button } from '@payloadcms/ui'
import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { InlineNotice } from '../ui/InlineNotice'

export interface IssuedCredential {
  id: string
  name: string
  prefix: string
}

/**
 * A deliberately ephemeral secret view: closing it removes its only UI copy.
 * O overlay é o `Dialog` do kit — o backdrop próprio e o listener de `Escape`
 * saíram junto, porque foco preso, `Esc` e clique fora agora são do primitivo.
 */
export function CredentialRevealDialog({
  credential,
  secretOnce,
  onClose,
}: {
  credential: IssuedCredential
  secretOnce: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(secretOnce)
      setCopied(true)
    } catch {
      // Sem Clipboard API (contexto inseguro, permissão negada) o operador ainda
      // seleciona o valor na mão — o segredo está visível no `<code>`.
      setCopied(false)
    }
  }

  return (
    <Dialog
      description={`${credential.name} (${credential.prefix}) is shown only once. Closing this window permanently removes it from the admin interface.`}
      footer={(
        <>
          <Button buttonStyle="secondary" margin={false} onClick={() => void copy()} type="button">
            {copied ? 'Copied' : 'Copy secret'}
          </Button>
          <Button margin={false} onClick={onClose} type="button">
            I saved it
          </Button>
        </>
      )}
      onClose={onClose}
      open
      title="Save this credential now"
      width="40rem"
    >
      <div className="credential-reveal">
        <code aria-label="Credential secret" className="credential-reveal__secret">{secretOnce}</code>
        <p className="credential-reveal__hint">
          Store it in your application’s secret manager. If it is lost, issue a replacement and revoke this credential.
        </p>
        <InlineNotice tone={copied ? 'success' : 'info'}>
          <p>
            {copied
              ? 'Secret copied to the clipboard.'
              : 'The clipboard copy is a convenience — the value stays readable here until you close this window.'}
          </p>
        </InlineNotice>
      </div>
    </Dialog>
  )
}
