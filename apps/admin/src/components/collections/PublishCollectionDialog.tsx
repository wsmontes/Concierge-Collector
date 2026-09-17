'use client'

import { Button } from '@payloadcms/ui'
import { useState } from 'react'
import type { PublishPreviewDto } from '../../collections/admin-client'
import { FactList } from '../ui/Card'
import { Dialog } from '../ui/Dialog'
import { CheckboxInput } from '../ui/Field'
import { InlineNotice } from '../ui/InlineNotice'

export interface PublishCollectionDialogProps {
  preview: PublishPreviewDto
  pending: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Publish confirmation built from the live preview, not from the list state:
 * every count below comes from the server response that the command is about to
 * be checked against. When the preview carries unavailable Curations, the
 * confirmation is a required checkbox — publishing them is a deliberate act.
 */
export function PublishCollectionDialog({
  preview,
  pending,
  error = null,
  onCancel,
  onConfirm,
}: PublishCollectionDialogProps) {
  const [confirmedUnavailable, setConfirmedUnavailable] = useState(preview.unavailableCount === 0)
  const needsUnavailableConfirmation = preview.unavailableCount > 0

  // Sem efeito de ressincronização: a identidade do preview é o `key` do
  // diálogo no call site, então um preview novo remonta o componente e este
  // inicializador já reflete os contadores atuais.

  return (
    <Dialog
      description="Publishing freezes this draft membership as a new version. Curation and Entity content remain live."
      footer={(
        <>
          <Button buttonStyle="secondary" disabled={pending} margin={false} onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button
            aria-label="Publish Collection now"
            disabled={pending || !confirmedUnavailable}
            margin={false}
            onClick={onConfirm}
            type="button"
          >
            {pending ? 'Publishing…' : 'Publish'}
          </Button>
        </>
      )}
      onClose={() => { if (!pending) onCancel() }}
      open
      title="Publish Collection"
    >
      <p className="collections-dialog__version">
        {preview.currentPublishedVersion
          ? `Version ${preview.currentPublishedVersion} → Version ${preview.nextVersion}`
          : `First publish → Version ${preview.nextVersion}`}
      </p>

      <FactList
        facts={[
          { label: 'Draft revision', value: preview.draftRevision.toLocaleString('en-US') },
          { label: 'Selection', value: `${preview.selectedCount.toLocaleString('en-US')} selected` },
          {
            label: 'Draft additions',
            value: `${preview.addCount.toLocaleString('en-US')} ${preview.addCount === 1 ? 'add' : 'adds'}`,
          },
          {
            label: 'Draft removals',
            value: `${preview.removeCount.toLocaleString('en-US')} ${preview.removeCount === 1 ? 'remove' : 'removes'}`,
          },
          { label: 'Availability', value: `${preview.availableCount.toLocaleString('en-US')} available` },
          { label: 'Unavailable', value: `${preview.unavailableCount.toLocaleString('en-US')} unavailable` },
        ]}
      />

      {needsUnavailableConfirmation && (
        <div className="collections-dialog__confirmation">
          <CheckboxInput
            checked={confirmedUnavailable}
            id="publish-unavailable-confirmation"
            label={`Publish with ${preview.unavailableCount.toLocaleString('en-US')} unavailable ${preview.unavailableCount === 1 ? 'Curation' : 'Curations'}`}
            onChange={setConfirmedUnavailable}
          />
        </div>
      )}

      {error && (
        <InlineNotice tone="error">
          <p>{error}</p>
        </InlineNotice>
      )}
    </Dialog>
  )
}
