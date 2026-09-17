'use client'

import { Button } from '@payloadcms/ui'
import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Field } from '../ui/Field'
import { InlineNotice } from '../ui/InlineNotice'

/**
 * Emissão de credencial. O overlay é o `Dialog` do kit (focus trap, `Esc`, clique
 * fora) e o campo usa o `Field` do kit — mas o `<input>` é nativo porque o
 * contrato de escrita precisa de `maxLength` e `autoFocus`, que o `TextInput` do
 * kit não expõe; perder o teto de 120 caracteres deixaria o servidor recusar o
 * que a UI deixou digitar.
 */
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
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (pending) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Credential name is required.')
      return
    }
    setError(null)
    try {
      await onIssue(trimmed)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'request_failed')
    }
  }

  return (
    <Dialog
      description={`Create an individually revocable read credential for ${applicationName}. Its secret will be shown only once.`}
      footer={(
        <>
          <Button buttonStyle="secondary" disabled={pending} margin={false} onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            aria-label="Issue credential now"
            disabled={pending}
            margin={false}
            onClick={() => void submit()}
            type="button"
          >
            {pending ? 'Issuing…' : 'Issue credential'}
          </Button>
        </>
      )}
      onClose={() => { if (!pending) onClose() }}
      open
      title="Issue credential"
    >
      <Field
        description="Shown in the credential list; the secret is never stored in the CMS."
        error={error ?? undefined}
        htmlFor="issue-credential-name"
        label="Credential name"
        required
      >
        <input
          autoFocus
          className="ui-input"
          disabled={pending}
          id="issue-credential-name"
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void submit() }}
          required
          value={name}
        />
      </Field>
    </Dialog>
  )
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
  return (
    <Dialog
      footer={(
        <>
          <Button buttonStyle="secondary" disabled={pending} margin={false} onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            buttonStyle={rotate ? 'primary' : 'error'}
            disabled={pending}
            margin={false}
            onClick={onConfirm}
            type="button"
          >
            {pending ? (rotate ? 'Rotating…' : 'Revoking…') : rotate ? 'Confirm rotate' : 'Confirm revoke'}
          </Button>
        </>
      )}
      onClose={() => { if (!pending) onClose() }}
      open
      title={title}
    >
      {rotate ? (
        <InlineNotice tone="info">
          <p>
            A new secret will be issued for <strong>{credentialName}</strong>. The current secret remains valid
            for {overlapHours} hours so the consumer can cut over safely.
          </p>
        </InlineNotice>
      ) : (
        <InlineNotice tone="warning">
          <p>
            Revoking <strong>{credentialName}</strong> takes effect on the next API request and cannot be undone.
            Issue a new credential if access is needed again.
          </p>
        </InlineNotice>
      )}
    </Dialog>
  )
}
