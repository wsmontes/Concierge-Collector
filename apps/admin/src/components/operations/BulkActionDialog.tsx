'use client'

import { Button } from '@payloadcms/ui'
import { useCallback, useEffect, useState } from 'react'
import { CheckboxInput } from '../ui/Field'
import { Dialog } from '../ui/Dialog'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { InlineNotice } from '../ui/InlineNotice'
import { SkeletonRows } from '../ui/Skeleton'

export interface CollectionOption {
  id: string
  slug: string
  title: string
  lifecycle: 'draft' | 'published' | 'archived'
  draftRevision: number
  draftState: string
  draftSelectedCount: number
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function editable(collection: CollectionOption): boolean {
  return collection.lifecycle !== 'archived' && collection.draftState !== 'publishing'
}

/**
 * Picks target Collections for a ready server-side selection and posts the bulk
 * intent. The browser never expands the selection into curation IDs: the body
 * carries only collectionIds and the action; the manifest stays on the server.
 * A Collection ID supplied by navigation is only a hint: it is preselected
 * after the live Collection list proves the target is currently editable.
 *
 * O overlay é o `Dialog` do kit: o backdrop próprio, o `Esc` e o foco preso
 * deixaram de ser responsabilidade desta tela.
 */
export function BulkActionDialog({
  selectionId,
  initialCollectionId,
  onClose,
  onPosted,
}: {
  selectionId: string
  initialCollectionId?: string | null
  onClose: () => void
  onPosted: (operationId: string) => void
}) {
  const [collections, setCollections] = useState<CollectionOption[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [action, setAction] = useState<'add' | 'remove'>('add')
  const [error, setError] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState(-1)
  const [loadError, setLoadError] = useState(false)
  const [targetWarning, setTargetWarning] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const loading = loadedKey !== reloadKey

  // Carregamento DERIVADO da chave de recarga: o efeito não liga `loading` nem
  // limpa erro de forma síncrona (isso é render em cascata); ele só grava o
  // resultado quando chega. `loading` é `loadedKey !== reloadKey`.
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/admin/v1/collections', { credentials: 'same-origin', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('unable_to_load_collections')
        return response.json() as Promise<{ items: CollectionOption[] }>
      })
      .then((data) => {
        setCollections(data.items)
        setLoadError(false)
        setLoadedKey(reloadKey)
        if (!initialCollectionId) return
        const target = data.items.find((collection) => collection.id === initialCollectionId)
        if (!target) {
          setTargetWarning('The target Collection is no longer available.')
          return
        }
        if (!editable(target)) {
          setTargetWarning('The target Collection is not currently editable.')
          return
        }
        setSelected(new Set([target.id]))
        setTargetWarning(null)
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        setLoadedKey(reloadKey)
        setLoadError(true)
        void cause
      })
    return () => { controller.abort() }
  }, [initialCollectionId, reloadKey])

  function toggle(collectionId: string, checked: boolean) {
    if (submitting) return
    const target = collections.find((collection) => collection.id === collectionId)
    if (!target || !editable(target)) return
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(collectionId)
      else next.delete(collectionId)
      return next
    })
  }

  const close = useCallback(() => {
    if (!submitting) onClose()
  }, [onClose, submitting])

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

  const pending = submitting
  return (
    <Dialog
      description="The selection stays server-side — the browser only sends the target Collections and the action."
      footer={(
        <>
          <Button buttonStyle="secondary" disabled={pending} margin={false} onClick={close} type="button">
            Cancel
          </Button>
          <Button
            disabled={selected.size === 0 || pending}
            margin={false}
            onClick={() => void submit()}
            type="button"
          >
            {pending ? 'Starting job…' : `Apply to ${selected.size} Collection${selected.size === 1 ? '' : 's'}`}
          </Button>
        </>
      )}
      onClose={close}
      open
      title="Apply selection to Collections"
      width="44rem"
    >
      <div className="operations-bulk">
        {targetWarning && (
          <InlineNotice tone="error">
            <p>{targetWarning}</p>
          </InlineNotice>
        )}

        <fieldset className="operations-bulk__action" disabled={pending}>
          <legend>Action</legend>
          <label className="ui-checkbox">
            <input checked={action === 'add'} name="bulk-action" onChange={() => setAction('add')} type="radio" />
            <span className="ui-field__label">Add to draft</span>
          </label>
          <label className="ui-checkbox">
            <input checked={action === 'remove'} name="bulk-action" onChange={() => setAction('remove')} type="radio" />
            <span className="ui-field__label">Remove from draft</span>
          </label>
        </fieldset>

        {loadError ? (
          <ErrorState
            description="The Collection list did not load, so no target can be picked."
            onRetry={() => setReloadKey((key) => key + 1)}
            retryLabel="Try again"
            title="Collections could not load"
          />
        ) : loading ? (
          <SkeletonRows rows={4} />
        ) : collections.length === 0 ? (
          <EmptyState
            description="Create or publish a Collection before applying a selection."
            title="No Collections available"
          />
        ) : (
          <div className="operations-bulk__collections">
            {collections.map((collection) => {
              const isEditable = editable(collection)
              const target = collection.lifecycle === 'archived' ? 'archived' : 'publishing'
              return (
                <CheckboxInput
                  checked={selected.has(collection.id)}
                  description={`${collection.slug} · ${collection.draftSelectedCount} in draft · rev ${collection.draftRevision}${isEditable ? '' : ` · ${target}`}`}
                  disabled={pending || !isEditable}
                  id={`bulk-collection-${collection.id}`}
                  key={collection.id}
                  label={collection.title}
                  onChange={(checked) => toggle(collection.id, checked)}
                />
              )
            })}
          </div>
        )}

        {error && (
          <InlineNotice tone="error">
            <p>{error}</p>
          </InlineNotice>
        )}
      </div>
    </Dialog>
  )
}
