'use client'

import { useState } from 'react'
import { ContentRecordError, type ContentRecord, type ContentRecordClient } from '../../curations/record-client'

function humanError(error: unknown): string {
  if (error instanceof ContentRecordError) {
    if (error.status === 401) return 'Your Admin session has expired.'
    if (error.status === 403) return 'Admin access is required.'
    // Never let an editor believe the save landed when someone else moved the record.
    if (error.status === 409 || error.status === 412) return 'This Curation changed since you opened it. Reload before saving.'
    if (error.status === 400) return 'That field cannot be edited here.'
    return error.code
  }
  return error instanceof Error ? error.message : 'request_failed'
}

/**
 * One editable field, read-first.
 *
 * A record screen that opens as a wall of inputs is unreadable, so the value is
 * shown as text and only that block becomes a form — the approved per-section
 * save instead of one giant "edit the whole document".
 */
export function CurationTextEditor({
  curationId,
  client,
  field,
  label,
  value,
  record,
  onSaved,
}: {
  curationId: string
  client: ContentRecordClient
  field: string
  label: string
  value: string | null
  record: Record<string, unknown>
  onSaved: (next: ContentRecord) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const version = typeof record.version === 'number' ? record.version : null

  function startEditing() {
    setDraft(value ?? '')
    setError(null)
    setEditing(true)
  }

  async function save() {
    // A record with no version cannot be fenced, and an unfenced write is a silent overwrite.
    if (pending || version === null) return
    setPending(true)
    setError(null)
    try {
      const normalized = draft.trim().length === 0 ? null : draft
      onSaved(await client.patchCuration(curationId, { [field]: normalized }, version))
      setEditing(false)
    } catch (cause) {
      setError(humanError(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="content-record__field" data-field={field}>
      <div className="content-record__field-head">
        <h3>{label}</h3>
        {!editing && (
          <button disabled={version === null} onClick={startEditing} type="button">Edit</button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            aria-label={label}
            onChange={(event) => setDraft(event.target.value)}
            rows={Math.min(20, Math.max(4, draft.split('\n').length + 1))}
            value={draft}
          />
          <div className="content-record__field-actions">
            <button disabled={pending} onClick={() => void save()} type="button">
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button disabled={pending} onClick={() => setEditing(false)} type="button">Cancel</button>
          </div>
        </>
      ) : value
        ? <p className="content-record__text">{value}</p>
        : <p className="content-record__hint">Not set.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
