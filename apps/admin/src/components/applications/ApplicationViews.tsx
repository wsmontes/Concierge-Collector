'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { CredentialRevealDialog, type IssuedCredential } from '../credentials/CredentialRevealDialog'

export interface ApplicationRecord {
  id: string
  name: string
  owner: string
  status: 'active' | 'suspended'
  allowedCollectionIds: string[]
  defaultRequestsPerMinute: number
  credentialsRevision: number
  revision: number
}

interface CredentialResponse {
  credential: IssuedCredential
  secret_once: string
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `admin-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    credentials: 'same-origin',
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: string } | null
    throw new Error(body?.code ?? 'request_failed')
  }
  return response.json() as Promise<T>
}

function selectedIds(value: string) {
  return [...new Set(value.split(/[\n,]/).map((id) => id.trim()).filter(Boolean))]
}

/** Command UI for applications and hash-only consumer credentials. */
export function ApplicationViews() {
  const [applications, setApplications] = useState<ApplicationRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [issuingFor, setIssuingFor] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<CredentialResponse | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api<{ items: ApplicationRecord[] }>('/api/admin/v1/applications')
      setApplications(result.items)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'request_failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void reload() }, 0)
    return () => window.clearTimeout(initialLoad)
  }, [reload])

  async function createApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const allowedCollectionIds = selectedIds(String(form.get('collectionIds') ?? ''))
    try {
      const created = await api<ApplicationRecord>('/api/admin/v1/applications', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestId(), 'X-Request-Id': requestId() },
        body: JSON.stringify({
          name: String(form.get('name') ?? ''),
          owner: String(form.get('owner') ?? ''),
          allowedCollectionIds,
          defaultRequestsPerMinute: Number(form.get('rate') ?? 60),
        }),
      })
      setApplications((current) => [...current, created].sort((left, right) => left.name.localeCompare(right.name)))
      event.currentTarget.reset()
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'request_failed')
    }
  }

  async function issue(application: ApplicationRecord) {
    const name = window.prompt(`Credential name for ${application.name}`)?.trim()
    if (!name) return
    setIssuingFor(application.id)
    try {
      const result = await api<CredentialResponse>(`/api/admin/v1/applications/${application.id}/credentials`, {
        method: 'POST',
        headers: { 'Idempotency-Key': requestId(), 'X-Request-Id': requestId() },
        body: JSON.stringify({ name, scopes: ['collections:read'] }),
      })
      setRevealed(result)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'request_failed')
    } finally {
      setIssuingFor(null)
    }
  }

  return (
    <main className="application-views">
      <header>
        <p className="collection-views__eyebrow">Distribution</p>
        <h1>Consumer applications</h1>
        <p>Grant each consumer only the Collections it needs. Credentials are individually revocable and their secrets are never stored in the CMS.</p>
      </header>
      {error && <p role="alert">Request failed: {error}</p>}
      <section aria-labelledby="new-application-title" className="application-views__create">
        <h2 id="new-application-title">New application</h2>
        <form onSubmit={createApplication}>
          <label>Name <input name="name" required maxLength={120} /></label>
          <label>Owner <input name="owner" required maxLength={200} /></label>
          <label>Collection IDs <textarea name="collectionIds" required rows={3} aria-describedby="collection-ids-help" /></label>
          <small id="collection-ids-help">One Mongo collection ID per line or separated by commas.</small>
          <label>Requests per minute <input name="rate" type="number" min="1" max="100000" defaultValue="60" required /></label>
          <button type="submit">Create application</button>
        </form>
      </section>
      <section aria-labelledby="applications-title">
        <h2 id="applications-title">Applications</h2>
        {loading ? <p role="status">Loading applications…</p> : applications.length === 0 ? <p>No consumer applications yet.</p> : (
          <ul className="application-views__list">
            {applications.map((application) => (
              <li key={application.id}>
                <div>
                  <h3>{application.name}</h3>
                  <p>{application.owner} · {application.status} · {application.allowedCollectionIds.length} Collections · {application.defaultRequestsPerMinute}/min</p>
                </div>
                <button type="button" onClick={() => void issue(application)} disabled={application.status !== 'active' || issuingFor === application.id}>
                  {issuingFor === application.id ? 'Issuing…' : 'Issue credential'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {revealed && (
        <CredentialRevealDialog
          credential={revealed.credential}
          secretOnce={revealed.secret_once}
          onClose={() => setRevealed(null)}
        />
      )}
    </main>
  )
}
