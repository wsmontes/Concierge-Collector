'use client'

import { Button } from '@payloadcms/ui'
import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { CredentialRevealDialog, type IssuedCredential } from '../credentials/CredentialRevealDialog'
import { AdminPage, AdminSection } from '../ui/AdminPage'
import { Chip } from '../ui/Chip'
import { DataTable, type DataTableColumn } from '../ui/DataTable'
import { EmptyState } from '../ui/EmptyState'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { ErrorState } from '../ui/ErrorState'
import { Field } from '../ui/Field'
import { InlineNotice } from '../ui/InlineNotice'
import { SkeletonRows } from '../ui/Skeleton'
import { StatusPill } from '../ui/StatusPill'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'
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
  applicationId?: string
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'error' | 'warning'; message: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [issuingApplication, setIssuingApplication] = useState<ApplicationRecord | null>(null)
  const [issuingFor, setIssuingFor] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<CredentialResponse | null>(null)
  const [credentials, setCredentials] = useState<Record<string, CredentialRecord[]>>({})
  const [credentialErrors, setCredentialErrors] = useState<Record<string, string>>({})
  const [openCredentials, setOpenCredentials] = useState<string[]>([])
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
      setLoadError(null)
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'request_failed')
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
      setNotice({ tone: 'error', message: 'Select at least one published Collection.' })
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
      setNotice(null)
    } catch (cause) {
      setNotice({ tone: 'error', message: cause instanceof Error ? cause.message : 'request_failed' })
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
      setNotice(null)
    } catch (cause) {
      if (cause instanceof ApplicationApiError && cause.status === 412) {
        await reload()
        setEditingApplication(null)
        setNotice({ tone: 'warning', message: 'Application changed on the server. The latest access has been reloaded.' })
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
      setNotice(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'request_failed'
      setNotice({ tone: 'error', message })
      throw new Error(message)
    } finally {
      setIssuingFor(null)
    }
  }

  /**
   * Abre o painel de credenciais e busca a lista na primeira abertura. Reabrir
   * usa o que já está em memória — a ação de gerenciar credencial é leitura, e
   * uma lista de credenciais por aplicação não muda sem passar por esta tela.
   */
  async function toggleCredentials(applicationId: string) {
    if (openCredentials.includes(applicationId)) {
      setOpenCredentials((current) => current.filter((id) => id !== applicationId))
      return
    }
    setOpenCredentials((current) => [...current, applicationId])
    if (credentials[applicationId]) return
    await loadCredentials(applicationId)
  }

  /** Leitura das credenciais de um aplicativo, com erro por aplicativo e retry. */
  async function loadCredentials(applicationId: string) {
    setCredentialLoading(applicationId)
    try {
      const result = await api<{ items: CredentialRecord[] }>(`/api/admin/v1/applications/${applicationId}/credentials`)
      setCredentials((current) => ({ ...current, [applicationId]: result.items }))
      setCredentialErrors((current) => {
        const next = { ...current }
        delete next[applicationId]
        return next
      })
    } catch (cause) {
      setCredentialErrors((current) => ({
        ...current,
        [applicationId]: cause instanceof Error ? cause.message : 'request_failed',
      }))
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
      setNotice(null)
    } catch (cause) {
      setNotice({ tone: 'error', message: cause instanceof Error ? cause.message : 'request_failed' })
    } finally {
      setCredentialCommandPending(false)
    }
  }

  /**
   * Colunas das credenciais de UM aplicativo: a rota de rotação/revogação é
   * endereçada por credencial, mas o estado local é indexado por aplicativo, e a
   * listagem não devolve o vínculo em cada linha — então ele vem por parâmetro
   * em vez de ser adivinhado a partir da resposta.
   */
  function credentialColumns(applicationId: string): Array<DataTableColumn<CredentialRecord>> {
    return [
    {
      key: 'name',
      header: 'Name',
      width: 'minmax(10rem, 1.2fr)',
      cell: (credential) => (
        <span className="ui-table__cell-stack">
          <span className="ui-table__primary">{credential.name}</span>
          <code className="ui-table__mono">{credential.prefix}</code>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '8rem',
      cell: (credential) => <StatusPill label={credential.status} status={credential.status} />,
    },
    {
      key: 'expires',
      header: 'Expires',
      width: '9rem',
      cell: (credential) => {
        if (!credential.expiresAt) return <span className="ui-table__secondary">No expiry</span>
        return (
          <time dateTime={credential.expiresAt} title={formatAbsoluteDate(credential.expiresAt) ?? undefined}>
            {formatRelativeDate(credential.expiresAt)}
          </time>
        )
      },
    },
    {
      key: 'lastUsed',
      header: 'Last used',
      width: '9rem',
      cell: (credential) => (
        credential.lastUsedAt
          ? (
            <time dateTime={credential.lastUsedAt} title={formatAbsoluteDate(credential.lastUsedAt) ?? undefined}>
              {formatRelativeDate(credential.lastUsedAt)}
            </time>
          )
          : <span className="ui-table__secondary">Never</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '10rem',
      align: 'end',
      cell: (credential) => (
        <span className="application-credential__actions">
          <Button
            aria-label={`Rotate ${credential.name}`}
            buttonStyle="secondary"
            disabled={credential.status !== 'active'}
            margin={false}
            onClick={() => setCredentialCommand({ action: 'rotate', applicationId, credential })}
            size="small"
            type="button"
          >
            Rotate
          </Button>
          <Button
            aria-label={`Revoke ${credential.name}`}
            buttonStyle="error"
            disabled={credential.status !== 'active'}
            margin={false}
            onClick={() => setCredentialCommand({ action: 'revoke', applicationId, credential })}
            size="small"
            type="button"
          >
            Revoke
          </Button>
        </span>
      ),
    },
    ]
  }

  return (
    <AdminPage
      eyebrow="Distribution"
      title="Applications"
      description="Grant each consumer only the Collections it needs. Credentials are individually revocable and their secrets are never stored in the CMS."
    >
      {notice && (
        <InlineNotice tone={notice.tone}>
          <p>{notice.message}</p>
        </InlineNotice>
      )}

      <AdminSection
        title="New application"
        description="Define ownership, Collection access and a default request budget before issuing credentials."
      >
        <form className="applications-form" onSubmit={createApplication}>
          <div className="applications-form__identity">
            <Field htmlFor="application-name" label="Name" required>
              <input className="ui-input" id="application-name" maxLength={120} name="name" required />
            </Field>
            <Field htmlFor="application-owner" label="Owner" required>
              <input className="ui-input" id="application-owner" maxLength={200} name="owner" required />
            </Field>
            <Field htmlFor="application-rate" label="Requests per minute" required>
              <input className="ui-input" defaultValue={60} id="application-rate" max={100000} min={1} name="rate" required type="number" />
            </Field>
          </div>
          <CollectionAccessPicker onChange={setNewApplicationCollections} value={newApplicationCollections} />
          <div className="applications-form__actions">
            <Button icon="plus" margin={false} type="submit">Create application</Button>
          </div>
        </form>
      </AdminSection>

      <AdminSection
        title="Applications"
        description="Manage Collection grants and credentials independently for every consumer."
      >
        <ErrorBoundary onRetry={() => void reload()} title="Applications could not be displayed">
          {loading ? (
            <SkeletonRows rows={4} />
          ) : loadError !== null && applications.length === 0 ? (
            <ErrorState
              description={`The application list did not respond: ${loadError}`}
              onRetry={() => void reload()}
              retryLabel="Try again"
              title="Applications could not load"
            />
          ) : applications.length === 0 ? (
            <EmptyState
              description="Create an Application to issue scoped credentials for published Collections."
              title="No Applications yet"
            />
          ) : (
            <ul className="applications-list">
              {applications.map((application) => (
                <li className="application-card" key={application.id}>
                  <div className="application-card__header">
                    <div className="application-card__identity">
                      <div className="application-card__title-row">
                        <h3 className="application-card__name">{application.name}</h3>
                        <StatusPill label={application.status} status={application.status} />
                      </div>
                      <p className="application-card__owner">
                        {application.owner} · {application.defaultRequestsPerMinute.toLocaleString('en-US')}/min · revision {application.revision}
                      </p>
                    </div>
                    <div className="application-card__actions">
                      <Button
                        aria-label={`Edit access for ${application.name}`}
                        buttonStyle="secondary"
                        margin={false}
                        onClick={() => setEditingApplication(application)}
                        size="small"
                        type="button"
                      >
                        Edit access
                      </Button>
                      <Button
                        disabled={application.status !== 'active' || issuingFor === application.id}
                        margin={false}
                        onClick={() => setIssuingApplication(application)}
                        size="small"
                        type="button"
                      >
                        {issuingFor === application.id ? 'Issuing…' : 'Issue credential'}
                      </Button>
                      <Button
                        aria-busy={credentialLoading === application.id}
                        aria-expanded={openCredentials.includes(application.id)}
                        buttonStyle="secondary"
                        disabled={credentialLoading === application.id}
                        margin={false}
                        onClick={() => void toggleCredentials(application.id)}
                        size="small"
                        type="button"
                      >
                        {openCredentials.includes(application.id) ? 'Hide credentials' : 'Manage credentials'}
                      </Button>
                    </div>
                  </div>

                  <details className="application-card__grants">
                    <summary>
                      <Chip count={application.allowedCollectionIds.length} tone={application.allowedCollectionIds.length > 0 ? 'accent' : 'muted'}>
                        Collections granted
                      </Chip>
                      <span className="ui-table__secondary">Show granted Collections</span>
                    </summary>
                    <p className="ui-table__secondary">
                      Access is stored per Collection and cannot be wider than what each one published.
                    </p>
                    {application.allowedCollectionIds.length === 0 ? (
                      <p className="ui-table__secondary">No Collection granted yet.</p>
                    ) : (
                      <ul className="application-card__grant-list">
                        {application.allowedCollectionIds.map((collectionId) => (
                          <li key={collectionId}>
                            <Link href={`/admin/collections/collections/${encodeURIComponent(collectionId)}`}>
                              <code className="ui-table__mono">{collectionId}</code>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>

                  {openCredentials.includes(application.id) && (
                    <div aria-label={`${application.name} credentials`} className="application-card__credentials" role="group">
                      {credentialErrors[application.id] ? (
                        <ErrorState
                          description={`The credential list did not respond: ${credentialErrors[application.id]}`}
                          onRetry={() => void loadCredentials(application.id)}
                          retryLabel="Try again"
                          title="Credentials could not load"
                        />
                      ) : (
                      <DataTable
                        caption="Credentials"
                        columns={credentialColumns(application.id)}
                        density="compact"
                        empty={(
                          <EmptyState
                            description="Issue a credential to let this consumer read its granted Collections."
                            title="No credentials issued"
                          />
                        )}
                        loading={credentialLoading === application.id}
                        rowKey={(credential) => credential.id}
                        rows={credentials[application.id] ?? []}
                        skeletonRows={2}
                      />
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ErrorBoundary>
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
