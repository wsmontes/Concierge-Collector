'use client'

import { Button } from '@payloadcms/ui'
import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { InlineNotice } from '../ui/InlineNotice'
import { TextInput } from '../ui/Field'
import { CollectionAccessPicker } from './CollectionAccessPicker'
import type { ApplicationRecord } from './ApplicationViews'

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

  const rateIsValid = Number.isInteger(rate) && rate >= 1 && rate <= 100000

  async function save() {
    if (pending || !rateIsValid) return
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
    <Dialog
      description={`Grant only the Collections this consumer needs. ${application.allowedCollectionIds.length.toLocaleString('en-US')} granted today.`}
      footer={(
        <>
          <Button buttonStyle="secondary" disabled={pending} margin={false} onClick={onClose} type="button">
            Cancel
          </Button>
          <Button disabled={pending || !rateIsValid} margin={false} onClick={() => void save()} type="button">
            {pending ? 'Saving…' : 'Save access'}
          </Button>
        </>
      )}
      onClose={() => { if (!pending) onClose() }}
      open
      title={`Edit ${application.name} access`}
      width="46rem"
    >
      <div className="application-access">
        <TextInput
          description="Default request budget for this consumer."
          error={rateIsValid ? undefined : 'Enter a whole number between 1 and 100000.'}
          id="application-access-rate"
          label="Requests per minute"
          onChange={(value) => setRate(Number(value))}
          type="number"
          value={String(rate)}
        />
        <CollectionAccessPicker
          disabled={pending}
          onChange={setCollectionIds}
          value={collectionIds}
        />
        {error && (
          <InlineNotice tone="error">
            <p>{error}</p>
          </InlineNotice>
        )}
      </div>
    </Dialog>
  )
}
