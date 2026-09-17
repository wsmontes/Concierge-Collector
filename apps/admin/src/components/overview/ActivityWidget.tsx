'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@payloadcms/ui'
import { isRecord } from '../../content/value-guards'
import { AdminSection } from '../ui/AdminPage'
import { Chip, humanizeStatus, statusTone } from '../ui/Chip'
import { ErrorState } from '../ui/ErrorState'
import { SkeletonRows } from '../ui/Skeleton'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'

/** The list endpoints the panel reads; both are the same ones the screens use. */
const CURATIONS_PATH = '/api/admin/v1/curations?sort=updated_at_desc&limit=6'
const OPERATIONS_PATH = '/api/admin/v1/operation-history'
const PUBLISH_JOBS_PATH = '/api/admin/v1/publish-jobs'

interface RecentCuration {
  id: string
  city: string | null
  entityType: string | null
  name: string
  status: string
  updatedAt: string | null
}

interface PipelineRow {
  id: string
  label: string
  status: string
  updatedAt: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toRecentCuration(value: unknown): RecentCuration | null {
  if (!isRecord(value)) return null
  const id = text(value.curation_id)
  if (id === null) return null
  return {
    id,
    city: text(value.city),
    entityType: text(value.entity_type),
    name: text(value.restaurant_name) ?? id,
    status: text(value.status) ?? 'unknown',
    updatedAt: text(value.updated_at),
  }
}

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`http_${response.status}`)
  return response.json()
}

/**
 * Painel de atividade: o que mudou por último e o que está rodando.
 *
 * Existe porque o dashboard anterior respondia apenas "quantos registros eu
 * tenho". Um CMS editorial precisa responder "o que mudou desde que eu saí" e "o
 * que está na fila" — as duas perguntas que fazem o operador abrir o Admin.
 */
interface ActivitySnapshot {
  recent: RecentCuration[] | null
  pipeline: PipelineRow[] | null
  error: string | null
}

export function ActivityWidget() {
  const [snapshot, setSnapshot] = useState<ActivitySnapshot>({ recent: null, pipeline: null, error: null })

  // `load` é PURA do ponto de vista do React: busca e devolve o retrato, sem
  // tocar em estado. O efeito grava o resultado no callback — nada de setState
  // síncrono no corpo do efeito, que é o que dispara render em cascata.
  const load = useCallback(async (): Promise<ActivitySnapshot> => {
    try {
      const [curations, operations, publishJobs] = await Promise.all([
        readJson(CURATIONS_PATH),
        readJson(OPERATIONS_PATH).catch(() => ({ items: [] })),
        readJson(PUBLISH_JOBS_PATH).catch(() => ({ items: [] })),
      ])
      const curationRows = Array.isArray((curations as { items?: unknown }).items)
        ? ((curations as { items: unknown[] }).items.map(toRecentCuration).filter(Boolean) as RecentCuration[])
        : []
      const operationRows: PipelineRow[] = Array.isArray((operations as { items?: unknown }).items)
        ? (operations as { items: Array<Record<string, unknown>> }).items.slice(0, 4).map((row) => ({
            id: String(row.id),
            label: `${humanizeStatus(String(row.action ?? 'operation'))} · ${Array.isArray(row.collections) ? row.collections.length : 0} collections`,
            status: String(row.status ?? 'unknown'),
            updatedAt: text(row.updatedAt),
          }))
        : []
      const jobRows: PipelineRow[] = Array.isArray((publishJobs as { items?: unknown }).items)
        ? (publishJobs as { items: Array<Record<string, unknown>> }).items.slice(0, 4).map((row) => {
            const collection = isRecord(row.collection) ? row.collection : {}
            return {
              id: String(row.id),
              label: `Publish · ${text(collection.title) ?? 'Collection'} v${String(row.targetVersion ?? '?')}`,
              status: String(row.status ?? 'unknown'),
              updatedAt: text(row.updatedAt),
            }
          })
        : []
      return { recent: curationRows, pipeline: [...operationRows, ...jobRows], error: null }
    } catch (cause) {
      return { recent: null, pipeline: null, error: cause instanceof Error ? cause.message : 'request_failed' }
    }
  }, [])

  useEffect(() => {
    let active = true
    void load().then((next) => {
      if (active) setSnapshot(next)
    })
    return () => {
      active = false
    }
  }, [load])

  const { recent, pipeline, error } = snapshot
  // A tentativa de novo volta ao estado de carregamento NO HANDLER (evento), que
  // é onde isso é permitido — e não como efeito colateral de um efeito.
  const retry = useCallback(() => {
    setSnapshot({ recent: null, pipeline: null, error: null })
    void load().then(setSnapshot)
  }, [load])

  return (
    <div className="dashboard-panels">
      <AdminSection
        className="dashboard-panel"
        description="The six most recently touched Curations."
        title="Recently updated"
      >
        {error !== null && (
          <ErrorState
            description={`The Admin BFF answered ${error}.`}
            onRetry={retry}
            title="Could not load dashboard activity"
          />
        )}
        {error === null && recent === null && <SkeletonRows rows={4} />}
        {recent?.length === 0 && <p className="ui-page__description">No Curations stored yet.</p>}
        {recent !== null && recent.length > 0 && (
          <ul className="dashboard-list">
            {recent.map((row) => (
              <li className="dashboard-list__item" key={row.id}>
                <a className="dashboard-list__link" href={`/admin/curations/${encodeURIComponent(row.id)}`}>
                  <span className="dashboard-list__title">{row.name}</span>
                  <span className="dashboard-list__meta">
                    {[row.city, row.entityType].filter(Boolean).join(' · ')}
                  </span>
                </a>
                <span className="dashboard-list__side">
                  <Chip size="sm" tone={statusTone(row.status)}>
                    {humanizeStatus(row.status)}
                  </Chip>
                  <time
                    className="dashboard-list__time"
                    dateTime={row.updatedAt ?? undefined}
                    title={formatAbsoluteDate(row.updatedAt) ?? undefined}
                  >
                    {formatRelativeDate(row.updatedAt)}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection
        className="dashboard-panel"
        action={
          <Button buttonStyle="secondary" size="small" url="/admin/operations">
            Open Operations
          </Button>
        }
        description="Bulk operations and publish jobs, newest first."
        title="Pipeline"
      >
        {error === null && pipeline === null && <SkeletonRows rows={3} />}
        {pipeline?.length === 0 && <p className="ui-page__description">Nothing in the queue.</p>}
        {pipeline !== null && pipeline.length > 0 && (
          <ul className="dashboard-list">
            {pipeline.map((row) => (
              <li className="dashboard-list__item" key={row.id}>
                <span className="dashboard-list__link">
                  <span className="dashboard-list__title">{row.label}</span>
                  <span className="dashboard-list__meta">
                    <time dateTime={row.updatedAt ?? undefined} title={formatAbsoluteDate(row.updatedAt) ?? undefined}>
                      {formatRelativeDate(row.updatedAt)}
                    </time>
                  </span>
                </span>
                <span className="dashboard-list__side">
                  <Chip size="sm" tone={statusTone(row.status)}>
                    {humanizeStatus(row.status)}
                  </Chip>
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </div>
  )
}
