'use client'

import { Button } from '@payloadcms/ui'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { CredentialRevealDialog, type IssuedCredential } from '../credentials/CredentialRevealDialog'
import { AdminPage, AdminSection } from '../ui/AdminPage'
import { EmptyState } from '../ui/EmptyState'
import { InlineNotice } from '../ui/InlineNotice'
import { StatusPill } from '../ui/StatusPill'
import { ApplicationAccessDialog } from './ApplicationAccessDialog'
import { CollectionAccessPicker } from './CollectionAccessPicker'
import { CredentialActionDialog, IssueCredentialDialog } from './CredentialCommandDialogs'

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

interface CredentialRecord extends IssuedCredential {
  applicationId: string
  status: 'active' | 'revoked'
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
}

type CredentialCommand = {
  action: 'rotate' | 'revoke'
  applicationId: string
  credential: CredentialRecord
}

class ApplicationApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
    this.name = 'ApplicationApiError'
  }
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `admin-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** Hours the rotated-away secret keeps working, so consumers can switch without a cutover. */
const ROTATE_OVERLAP_HOURS = 24

/**
 * Overlap deadline sent to the rotate endpoint. Module scope keeps the
 * impure clock read out of the component body.
 */
function rotateOverlapUntil() {
  return new Date(Date.now() + ROTATE_OVERLAP_HOURS * 60 * 60 * 1000).toISOString()
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    credentials: 'same-origin',
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null
    const code = typeof body?.error?.code === 'string' ? body.error.code : `http_${response.status}`
    throw new ApplicationApiError(code, response.status)
  }
  return response.json() as Promise<T>
}

/** Command UI for applications and hash-only consumer credentials. */
export function ApplicationViews() {
  const [applications, setApplications] = useState<ApplicationRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [issuingApplication, setIssuingApplication] = useState<ApplicationRecord | null>(null)
  const [issuingFor, setIssuingFor] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<CredentialResponse | null>(null)
  const [credentials, setCredentials] = useState<Record<string, CredentialRecord[]>>({})
  const [credentialLoading, setCredentialLoading] = useState<string | null>(null)
  const [credentialCommand, setCredentialCommand] = useState<CredentialCommand | null>(null)
  const [credentialCommandPending, setCredentialCommandPending] = useState(false)
  const [newApplicationCollections, setNewApplicationCollections] = useState<string[]>([])
  const [editingApplication, setEditingApplication] = useState<ApplicationRecord | null>(null)

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
    if (newApplicationCollections.length === 0) {
      setError('Select at least one published Collection.')
      return
    }
    const form = new FormData(event.currentTarget)
    try {
      const created = await api<ApplicationRecord>('/api/admin/v1/applications', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestId(), 'X-Request-Id': requestId() },
        body: JSON.stringify({
          name: String(form.get('name') ?? ''),
          owner: String(form.get('owner') ?? ''),
          allowedCollectionIds: newApplicationCollections,
          defaultRequestsPerMinute: Number(form.get('rate') ?? 60),
        }),
      })
      setApplications((current) => [...current, created].sort((left, right) => left.name.localeCompare(right.name)))
      event.currentTarget.reset()
      setNewApplicationCollections([])
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'request_failed')
    }
  }

  async function saveApplicationAccess(
    application: ApplicationRecord,
    input: { allowedCollectionIds: string[]; defaultRequestsPerMinute: number },
  ) {
    try {
      const updated = await api<ApplicationRecord>(`/api/admin/v1/applications/${application.id}`, {
        method: 'PATCH',
        headers: {
          'If-Match': String(application.revision),
          'Idempotency-Key': requestId(),
          'X-Request-Id': requestId(),
        },
        body: JSON.stringify(input),
      })
      setApplications((current) => current.map((item) => item.id === updated.id ? updated : item))
      setEditingApplication(null)
      setError(null)
    } catch (cause) {
      if (cause instanceof ApplicationApiError && cause.status === 412) {
        await reload()
        setEditingApplication(null)
        setError('Application changed on the server. The latest access has been reloaded.')
        return
      }
      throw cause
    }
  }

  async function issue(application: ApplicationRecord, name: string) {
    setIssuingFor(application.id)
    try {
      const result = await api<CredentialResponse>(`/api/admin/v1/applications/${application.id}/credentials`, {
        method: 'POST',
        headers: { 'Idempotency-Key': requestId(), 'X-Request-Id': requestId() },
        body: JSON.stringify({ name, scopes: ['collections:read'] }),
      })
      setRevealed(result)
      setIssuingApplication(null)
      setError(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'request_failed'
      setError(message)
      throw new Error(message)
    } finally {
      setIssuingFor(null)
    }
  }

  async function loadCredentials(applicationId: string) {
    if (credentials[applicationId]) {
      setCredentials((current) => {
        const next = { ...current }
        delete next[applicationId]
        return next
      })
      return
    }
    setCredentialLoading(applicationId)
    try {
      const result = await api<{ items: CredentialRecord[] }>(`/api/admin/v1/applications/${applicationId}/credentials`)
      setCredentials((current) => ({ ...current, [applicationId]: result.items }))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'request_failed')
    } finally {
      setCredentialLoading(null)
    }
  }

  async function revoke(applicationId: string, credential: CredentialRecord) {
    const revoked = await api<CredentialRecord>(`/api/admin/v1/credentials/${credential.id}/revoke`, {
      method: 'POST', headers: { 'X-Request-Id': requestId() },
    })
    setCredentials((current) => ({
      ...current,
      [applicationId]: (current[applicationId] ?? []).map((item) => item.id === revoked.id ? { ...item, ...revoked } : item),
    }))
  }

  async function rotate(applicationId: string, credential: CredentialRecord) {
    const result = await api<CredentialResponse>(`/api/admin/v1/credentials/${credential.id}/rotate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': requestId(), 'X-Request-Id': requestId() },
      body: JSON.stringify({ overlapUntil: rotateOverlapUntil() }),
    })
    setRevealed(result)
    const refreshed = await api<{ items: CredentialRecord[] }>(`/api/admin/v1/applications/${applicationId}/credentials`)
    setCredentials((current) => ({ ...current, [applicationId]: refreshed.items }))
  }

  async function confirmCredentialCommand() {
    if (!credentialCommand || credentialCommandPending) return
    const command = credentialCommand
    setCredentialCommandPending(true)
    try {
      if (command.action === 'rotate') await rotate(command.applicationId, command.credential)
      else await revoke(command.applicationId, command.credential)
      setCredentialCommand(null)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'request_failed')
    } finally {
      setCredentialCommandPending(false)
    }
  }

  return (
    <AdminPage
      className="application-views"
      eyebrow="Distribution"
      title="Consumer applications"
      description="Grant each consumer only the Collections it needs. Credentials are individually revocable and their secrets are never stored in the CMS."
    >
      {error && (
        <InlineNotice tone="error">
          <p>Request failed: {error}</p>
        </InlineNotice>
      )}

      <AdminSection
        title="New application"
        description="Define ownership, Collection access and a default request budget before issuing credentials."
      >
        <form className="application-views__form" onSubmit={createApplication}>
          <div className="application-views__identity-fields">
            <label>Name <input name="name" required maxLength={120} /></label>
            <label>Owner <input name="owner" required maxLength={200} /></label>
            <label>Requests per minute <input name="rate" type="number" min="1" max="100000" defaultValue="60" required /></label>
          </div>
          <CollectionAccessPicker value={newApplicationCollections} onChange={setNewApplicationCollections} />
          <div className="application-views__form-actions">
            <Button icon="plus" margin={false} type="submit">Create application</Button>
          </div>
        </form>
      </AdminSection>

      <AdminSection
        title="Applications"
        description="Manage Collection grants and credentials independently for every consumer."
      >
        {loading ? <p role="status">Loading applications…</p> : applications.length === 0 ? (
          <EmptyState
            title="No consumer applications yet"
            description="Create an application to issue scoped credentials for published Collections."
          />
        ) : (
          <ul className="application-views__list">
            {applications.map((application) => (
              <li className="application-card" key={application.id}>
                <div className="application-card__header">
                  <div className="application-card__identity">
                    <div className="application-card__title-row">
                      <h3>{application.name}</h3>
                      <StatusPill status={application.status} label={application.status} />
                    </div>
                    <p>{application.owner} · {application.allowedCollectionIds.length} Collections · {application.defaultRequestsPerMinute}/min</p>
                  </div>
                  <div className="application-card__actions">
                    <Button
                      buttonStyle="secondary"
                      margin={false}
                      size="small"
                      type="button"
                      aria-label={`Edit access for ${application.name}`}
                      onClick={() => setEditingApplication(application)}
                    >
                      Edit access
                    </Button>
                    <Button
                      margin={false}
                      size="small"
                      type="button"
                      onClick={() => setIssuingApplication(application)}
                      disabled={application.status !== 'active' || issuingFor === application.id}
                    >
                      {issuingFor === application.id ? 'Issuing…' : 'Issue credential'}
                    </Button>
                    <Button
                      buttonStyle="secondary"
                      margin={false}
                      size="small"
                      type="button"
                      onClick={() => void loadCredentials(application.id)}
                      disabled={credentialLoading === application.id}
                    >
                      {credentialLoading === application.id ? 'Loading…' : credentials[application.id] ? 'Hide credentials' : 'Manage credentials'}
                    </Button>
                  </div>
                </div>

                {credentials[application.id] && (
                  <div className="application-card__credentials">
                    <div className="application-card__credentials-heading">
                      <h4>Credentials</h4>
                      <span>{credentials[application.id].length.toLocaleString('en-US')} issued</span>
                    </div>
                    {credentials[application.id].length === 0 ? (
                      <p className="application-card__credentials-empty">No credentials issued.</p>
                    ) : (
                      <ul className="application-views__credentials" aria-label={`${application.name} credentials`}>
                        {credentials[application.id].map((credential) => (
                          <li key={credential.id}>
                            <div className="application-credential__identity">
                              <div className="application-credential__title-row">
                                <strong>{credential.name}</strong>
                                <StatusPill status={credential.status} label={credential.status} />
                              </div>
                              <p>{credential.prefix} · last use {credential.lastUsedAt ?? 'never'}</p>
                            </div>
                            <div className="application-credential__actions">
                              <Button
                                buttonStyle="secondary"
                                margin={false}
                                size="small"
                                type="button"
                                disabled={credential.status !== 'active'}
                                onClick={() => setCredentialCommand({ action: 'rotate', applicationId: application.id, credential })}
                              >Rotate</Button>
                              <Button
                                buttonStyle="error"
                                margin={false}
                                size="small"
                                type="button"
                                disabled={credential.status !== 'active'}
                                onClick={() => setCredentialCommand({ action: 'revoke', applicationId: application.id, credential })}
                              >Revoke</Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      {editingApplication && (
        <ApplicationAccessDialog
          application={editingApplication}
          onClose={() => setEditingApplication(null)}
          onSave={(input) => saveApplicationAccess(editingApplication, input)}
        />
      )}
      {issuingApplication && (
        <IssueCredentialDialog
          applicationName={issuingApplication.name}
          pending={issuingFor === issuingApplication.id}
          onClose={() => { if (!issuingFor) setIssuingApplication(null) }}
          onIssue={(name) => issue(issuingApplication, name)}
        />
      )}
      {credentialCommand && (
        <CredentialActionDialog
          action={credentialCommand.action}
          credentialName={credentialCommand.credential.name}
          overlapHours={ROTATE_OVERLAP_HOURS}
          pending={credentialCommandPending}
          onClose={() => { if (!credentialCommandPending) setCredentialCommand(null) }}
          onConfirm={() => void confirmCredentialCommand()}
        />
      )}
      {revealed && (
        <CredentialRevealDialog
          credential={revealed.credential}
          secretOnce={revealed.secret_once}
          onClose={() => setRevealed(null)}
        />
      )}
    </AdminPage>
  )
}
