'use client'

import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { isAdminRequestFailure } from '../../../content/record-types'
import { isRecord } from '../../../content/value-guards'
import { EditorFrame, textDraft, type FieldEditorProps } from './EditorFrame'

/** One selectable curator: the identity written into `curator_id` plus its labels. */
export interface CuratorOption {
  curator_id: string
  name: string | null
  email: string | null
}

export type SearchCurators = (query: string) => Promise<CuratorOption[]>

/** The Admin BFF route this picker searches (`src/payload/endpoints/curators.ts`). */
const DIRECTORY_PATH = '/api/admin/v1/records/curators'

/** Codes the BFF emits for the statuses a caller can meet here (`src/http/errors.ts`). */
const HOSTED_CODE: Record<number, string | undefined> = {
  400: 'invalid_request',
  401: 'authentication_required',
  403: 'authorization_denied',
  503: 'service_unavailable',
}

/**
 * Carries the numeric `status` and string `code` the frozen
 * `AdminRequestFailure` contract is narrowed on.
 */
class CuratorDirectoryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
    this.name = 'CuratorDirectoryError'
  }
}

async function failureCode(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null
  const code = body?.error?.code
  if (typeof code === 'string' && code.length > 0) return code
  return HOSTED_CODE[response.status] ?? `http_${response.status}`
}

/**
 * Keeps the rows a curator can actually be chosen from: an identity is what the
 * record stores, so a row without one is dropped rather than rendered as an
 * option that would write nothing meaningful.
 */
function toOptions(value: unknown): CuratorOption[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  const options: CuratorOption[] = []
  for (const entry of value.items) {
    if (!isRecord(entry)) continue
    const curatorId = entry.curator_id
    if (typeof curatorId !== 'string' || curatorId.length === 0) continue
    options.push({
      curator_id: curatorId,
      name: typeof entry.name === 'string' ? entry.name : null,
      email: typeof entry.email === 'string' ? entry.email : null,
    })
  }
  return options
}

/** `GET /api/admin/v1/records/curators?q=` from the browser. */
export const searchCuratorsFromBff: SearchCurators = async (query) => {
  const params = new URLSearchParams()
  const trimmed = query.trim()
  if (trimmed.length > 0) params.set('q', trimmed)
  const suffix = params.size > 0 ? `?${params.toString()}` : ''

  let response: Response
  try {
    response = await fetch(`${DIRECTORY_PATH}${suffix}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new CuratorDirectoryError(0, 'network_error')
  }
  if (!response.ok) throw new CuratorDirectoryError(response.status, await failureCode(response))
  return toOptions(await response.json())
}

/**
 * The BFF's own answer, never a friendlier rewrite: a refusal to read is
 * reported as what the BFF said (`authorization_revoked` for a 403), so the
 * editor can tell a denied reassignment from an empty directory.
 */
function failureMessage(error: unknown): string {
  if (isAdminRequestFailure(error)) return error.code
  return error instanceof Error ? error.message : 'request_failed'
}

/**
 * The curator control for `curator_id` (plan §3): the value is an identity no
 * text box can validate, so the editor searches the real directory, picks a
 * row and applies it. Applying goes through the page's ordinary save path —
 * this control only reports the chosen `curator_id`.
 */
export function CuratorPickerField({
  node,
  onCommit,
  onCancel,
  searchCurators = searchCuratorsFromBff,
}: FieldEditorProps & { searchCurators?: SearchCurators }): ReactNode {
  const controlId = useId()
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<CuratorOption[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * One bounded request per typed query, started from the effect and applied
   * from its callbacks: an effect body must not set state on its own turn, and
   * a superseded response is dropped instead of overwriting a newer search.
   */
  useEffect(() => {
    let cancelled = false
    void searchCurators(query).then(
      (found) => {
        if (cancelled) return
        setOptions(found)
        setError(null)
        setLoading(false)
      },
      (cause: unknown) => {
        if (cancelled) return
        setOptions([])
        setError(failureMessage(cause))
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [query, searchCurators])

  const current = textDraft(node.value)

  return (
    <EditorFrame node={node} controlId={controlId} error={error} onCancel={onCancel}>
      <input
        className="content-editor__input"
        id={controlId}
        type="search"
        placeholder="Search curators by name or email"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setSelected(null)
          setLoading(true)
        }}
      />
      <p className="curator-picker__current">
        {current === '' ? 'No curator applied.' : `Applied curator: ${current}`}
      </p>
      {loading && <p role="status">Searching curators…</p>}
      {!loading && error === null && options.length === 0 && (
        <p className="curator-picker__empty">No curators match this search.</p>
      )}
      {options.length > 0 && (
        <ul className="curator-picker__results">
          {options.map((option) => (
            <li key={option.curator_id}>
              <button
                className="curator-picker__result"
                type="button"
                aria-pressed={selected === option.curator_id}
                onClick={() => setSelected(option.curator_id)}
              >
                {option.name ?? option.curator_id}
                {option.email !== null && option.email !== option.name ? ` · ${option.email}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="curator-picker__apply"
        type="button"
        disabled={selected === null}
        onClick={() => {
          if (selected !== null) onCommit(selected)
        }}
      >
        Apply curator
      </button>
    </EditorFrame>
  )
}
