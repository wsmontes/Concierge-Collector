'use client'

import { Button } from '@payloadcms/ui'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  createBrowserOperationsAdminClient,
  type BulkOperationHistoryRow,
  type OperationsAdminClient,
  type PublishJobHistoryRow,
} from '../../operations/admin-client'
import { AdminPage } from '../ui/AdminPage'
import { FactList } from '../ui/Card'
import { Chip, statusTone } from '../ui/Chip'
import { DataTable, type DataTableColumn } from '../ui/DataTable'
import { Drawer } from '../ui/Drawer'
import { EmptyState } from '../ui/EmptyState'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { ErrorState } from '../ui/ErrorState'
import { InlineNotice } from '../ui/InlineNotice'
import { Skeleton } from '../ui/Skeleton'
import { StatusPill } from '../ui/StatusPill'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'

const browserClient = createBrowserOperationsAdminClient()

const TERMINAL_PUBLISH = new Set([
  'completed',
  'failed',
  'cancelled',
  'stale',
  'conflicted',
  'authorization_revoked',
])

/**
 * Uma fila, não duas. Antes a tela empilhava dois cartões por linha (bulk e
 * publicação) sem coluna, sem hierarquia e sem como abrir o detalhe — e o
 * histórico de operação só tinha o id como chave. Aqui bulk e publicação são
 * linhas do MESMO tipo, discriminadas por `kind`, para que a fila tenha colunas,
 * ordenação de leitura e um detalhe único no `Drawer` do kit.
 */
type QueueRow =
  | { key: string; kind: 'bulk'; operation: BulkOperationHistoryRow }
  | { key: string; kind: 'publish'; job: PublishJobHistoryRow }

function progressLabel(progress: BulkOperationHistoryRow['progress']): string {
  const parts = [
    progress.processed > 0 ? `${progress.processed} applied` : null,
    progress.skipped > 0 ? `${progress.skipped} skipped` : null,
    progress.failed > 0 ? `${progress.failed} failed` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'queued'
}

/**
 * Fração concluída da linha. Bulk tem contagem por filho (resolvidos/total);
 * publicação não expõe contagem de progresso, mas expõe a seleção e quantos
 * itens ficaram confirmadamente indisponíveis — que é a única fração real
 * disponível. Sem número, a coluna não inventa barra.
 */
function rowProgress(row: QueueRow): { done: number; total: number; label: string } | null {
  if (row.kind === 'bulk') {
    const { active, completed, failed } = row.operation.parentSummary
    const total = active + completed + failed
    if (total === 0) return null
    return { done: completed + failed, total, label: progressLabel(row.operation.progress) }
  }
  const { selectedCount, confirmedUnavailableCount } = row.job
  if (selectedCount === null || selectedCount <= 0) return null
  return {
    done: confirmedUnavailableCount,
    total: selectedCount,
    label: `${confirmedUnavailableCount.toLocaleString('en-US')} of ${selectedCount.toLocaleString('en-US')} confirmed unavailable`,
  }
}

function rowTitle(row: QueueRow): string {
  if (row.kind === 'bulk') return row.operation.action === 'add' ? 'Add to draft' : 'Remove from draft'
  return `${row.job.collection.title} · version ${row.job.targetVersion}`
}

function rowSubtitle(row: QueueRow): string | null {
  if (row.kind === 'bulk') {
    const { active, completed, failed } = row.operation.parentSummary
    return `${active} pending, ${completed} done, ${failed} failed`
  }
  return row.job.checkpoint
}

/** Resumo por estado, derivado do que a tela já carregou — nenhuma leitura extra. */
function statusCounts(rows: QueueRow[]): Array<{ status: string; count: number }> {
  const counts: Record<string, number> = {}
  for (const row of rows) {
    const status = row.kind === 'bulk' ? row.operation.status : row.job.status
    counts[status] = (counts[status] ?? 0) + 1
  }
  return Object.entries(counts)
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status))
}

/** Some com o clique do controle de linha: a linha abre o detalhe, os links navegam. */
function swallowClick(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

export function OperationsWorkspace({
  client = browserClient,
  pollMs = 5_000,
}: {
  client?: OperationsAdminClient
  pollMs?: number
}) {
  const [bulk, setBulk] = useState<BulkOperationHistoryRow[]>([])
  const [bulkCursor, setBulkCursor] = useState<string | null>(null)
  const [publishes, setPublishes] = useState<PublishJobHistoryRow[]>([])
  const [publishCursor, setPublishCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [bulkPage, publishPage] = await Promise.all([
        client.bulkOperations(),
        client.publishJobs(),
      ])
      setBulk(bulkPage.items)
      setBulkCursor(bulkPage.nextCursor)
      setPublishes(publishPage.items)
      setPublishCursor(publishPage.nextCursor)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'operations_unavailable')
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [bulkPage, publishPage] = await Promise.all([
          client.bulkOperations(),
          client.publishJobs(),
        ])
        if (!active) return
        setBulk(bulkPage.items)
        setBulkCursor(bulkPage.nextCursor)
        setPublishes(publishPage.items)
        setPublishCursor(publishPage.nextCursor)
        setError(null)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'operations_unavailable')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [client])

  useEffect(() => {
    const hasLiveWork = bulk.some((operation) => operation.status === 'active') ||
      publishes.some((job) => !TERMINAL_PUBLISH.has(job.status))
    if (!hasLiveWork) return
    const timer = window.setInterval(() => { void reload() }, pollMs)
    return () => window.clearInterval(timer)
  }, [bulk, publishes, pollMs, reload])

  async function loadMoreBulk() {
    if (!bulkCursor) return
    try {
      const page = await client.bulkOperations(bulkCursor)
      setBulk((current) => [...current, ...page.items])
      setBulkCursor(page.nextCursor)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'operations_unavailable')
    }
  }

  async function loadMorePublishes() {
    if (!publishCursor) return
    try {
      const page = await client.publishJobs(publishCursor)
      setPublishes((current) => [...current, ...page.items])
      setPublishCursor(page.nextCursor)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'operations_unavailable')
    }
  }

  async function cancel(operation: BulkOperationHistoryRow) {
    if (operation.status !== 'active' || !operation.cancellable || cancelling) return
    setCancelling(operation.id)
    try {
      await client.cancelOperation(operation.id)
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'cancel_failed')
    } finally {
      setCancelling(null)
    }
  }

  // As linhas são derivadas das duas páginas carregadas; o cursor de cada origem
  // continua sendo o do servidor, então paginar segue sendo paginar.
  const rows: QueueRow[] = [
    ...bulk.map((operation): QueueRow => ({ key: `bulk:${operation.id}`, kind: 'bulk', operation })),
    ...publishes.map((job): QueueRow => ({ key: `publish:${job.id}`, kind: 'publish', job })),
  ]
  const counts = statusCounts(rows)
  const selected = rows.find((row) => row.key === selectedKey) ?? null
  const blocked = error !== null && rows.length === 0 && !loading
  const detailCollectionId = selected === null
    ? null
    : selected.kind === 'bulk'
      ? selected.operation.collections[0]?.id ?? null
      : selected.job.collection.id

  function cancelButton(row: QueueRow) {
    if (row.kind !== 'bulk') return null
    const { operation } = row
    if (operation.status !== 'active' || !operation.cancellable) return null
    return (
      <Button
        aria-label="Cancel operation"
        buttonStyle="error"
        disabled={cancelling === operation.id}
        margin={false}
        onClick={() => void cancel(operation)}
        size="small"
        type="button"
      >
        {cancelling === operation.id ? 'Cancelling…' : 'Cancel'}
      </Button>
    )
  }

  /**
   * Retomar trabalho falho não tem endpoint próprio — e não vai ter: o BFF expõe
   * só leitura de histórico e cancelamento. A releitura do trabalho é a ação da
   * Collection (draft ou publicação), que já valida permissão e estado. O que a
   * fila pode fazer é levar o operador até lá, em vez de oferecer um botão que
   * não existe.
   */
  function retryLink(row: QueueRow) {
    const status = row.kind === 'bulk' ? row.operation.status : row.job.status
    if (status !== 'failed') return null
    const collectionId = row.kind === 'bulk' ? row.operation.collections[0]?.id : row.job.collection.id
    if (!collectionId) return null
    return (
      <Link
        className="operations-queue__retry"
        href={`/admin/collections/collections/${encodeURIComponent(collectionId)}`}
        title="Re-run this work from the Collection, where permissions and draft state are enforced"
      >
        Retry in Collection
      </Link>
    )
  }

  const columns: Array<DataTableColumn<QueueRow>> = [
    {
      key: 'work',
      header: 'Work',
      width: 'minmax(12rem, 1.4fr)',
      cell: (row) => (
        <span className="ui-table__cell-stack">
          <span className="ui-table__primary">{rowTitle(row)}</span>
          {rowSubtitle(row) && <span className="ui-table__secondary">{rowSubtitle(row)}</span>}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '9rem',
      cell: (row) => (
        <StatusPill status={row.kind === 'bulk' ? row.operation.status : row.job.status} />
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      width: 'minmax(10rem, 1fr)',
      cell: (row) => {
        const progress = rowProgress(row)
        if (!progress) return <span className="ui-table__secondary">Not started</span>
        const percent = Math.round((progress.done / progress.total) * 100)
        return (
          <span className="ui-table__cell-stack">
            <span
              aria-label={`Progress: ${progress.label}`}
              aria-valuemax={progress.total}
              aria-valuemin={0}
              aria-valuenow={progress.done}
              className="ui-meter"
              role="progressbar"
            >
              <span className="ui-meter__value" style={{ display: 'block', width: `${percent}%` }} />
            </span>
            <span className="ui-table__secondary">{progress.label}</span>
          </span>
        )
      },
    },
    {
      key: 'collections',
      header: 'Collections',
      width: 'minmax(8rem, 1fr)',
      cell: (row) => {
        const collections = row.kind === 'bulk'
          ? row.operation.collections
          : [row.job.collection]
        return (
          <span className="operations-queue__collections" onClick={swallowClick}>
            {collections.map((collection) => (
              <Link
                className="operations-queue__collection"
                href={`/admin/collections/collections/${encodeURIComponent(collection.id)}`}
                key={collection.id}
              >
                {collection.title}
              </Link>
            ))}
          </span>
        )
      },
    },
    {
      key: 'updated',
      header: 'Updated',
      width: '9rem',
      align: 'end',
      cell: (row) => {
        const value = row.kind === 'bulk' ? row.operation.updatedAt : row.job.updatedAt
        const absolute = formatAbsoluteDate(value)
        return <time dateTime={value} title={absolute ?? undefined}>{formatRelativeDate(value)}</time>
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '12rem',
      align: 'end',
      cell: (row) => (
        <span className="operations-queue__actions" onClick={swallowClick}>
          {retryLink(row)}
          {cancelButton(row)}
        </span>
      ),
    },
  ]

  return (
    <AdminPage
      className="operations-workspace"
      eyebrow="Operations"
      title="Operations"
      description="Bulk draft work and Collection publication jobs, in one queue."
      actions={(
        <Button buttonStyle="secondary" margin={false} onClick={() => void reload()} type="button">
          Refresh
        </Button>
      )}
    >
      <ErrorBoundary onRetry={() => void reload()} title="The queue summary could not be displayed">
        {loading
          ? (
            <div className="operations-queue__summary" aria-hidden="true">
              <Skeleton width="9rem" />
              <Skeleton width="9rem" />
              <Skeleton width="9rem" />
            </div>
          )
          : counts.length > 0 && (
            <ul className="operations-queue__summary" aria-label="Queue summary by status">
              {counts.map((entry) => (
                <li key={entry.status}>
                  <Chip count={entry.count} tone={statusTone(entry.status)}>
                    {entry.status === 'active' ? 'In progress' : entry.status}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
      </ErrorBoundary>

      <ErrorBoundary onRetry={() => void reload()} title="The Operations queue could not be displayed">
        {blocked ? (
          <ErrorState
            title="Operations could not load"
            description={`The queue did not respond: ${error}. The container may be restarting.`}
            onRetry={() => void reload()}
            retryLabel="Try again"
          />
        ) : (
          <>
            {error && (
              <InlineNotice
                action={(
                  <Button buttonStyle="secondary" margin={false} onClick={() => void reload()} size="small" type="button">
                    Try again
                  </Button>
                )}
                tone="error"
              >
                <p>Unable to refresh Operations: {error}</p>
              </InlineNotice>
            )}
            <DataTable
              caption="Operations"
              columns={columns}
              empty={(
                <EmptyState
                  action={(
                    <Button buttonStyle="secondary" margin={false} onClick={() => void reload()} type="button">
                      Refresh queue
                    </Button>
                  )}
                  description="Bulk draft work from the Curation Explorer and Collection publications will appear here as they run."
                  title="No operations yet"
                />
              )}
              footer={(
                <div className="operations-queue__footer">
                  <span className="ui-table__secondary">
                    {rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'entry' : 'entries'}
                  </span>
                  <span className="ui-toolbar__group ui-toolbar__group--end">
                    {bulkCursor && (
                      <Button buttonStyle="secondary" margin={false} onClick={() => void loadMoreBulk()} size="small" type="button">
                        Load more draft work
                      </Button>
                    )}
                    {publishCursor && (
                      <Button buttonStyle="secondary" margin={false} onClick={() => void loadMorePublishes()} size="small" type="button">
                        Load more publications
                      </Button>
                    )}
                  </span>
                </div>
              )}
              loading={loading}
              onActivate={(row) => setSelectedKey(row.key)}
              rowKey={(row) => row.key}
              rows={rows}
            />
          </>
        )}
      </ErrorBoundary>

      <Drawer
        onClose={() => setSelectedKey(null)}
        open={selected !== null}
        title={selected ? rowTitle(selected) : 'Operation detail'}
      >
        <ErrorBoundary onRetry={() => void reload()} title="The operation detail could not be displayed">
          {selected && (
          <div className="operations-detail">
            <FactList
              facts={selected.kind === 'bulk'
                ? [
                  { label: 'Kind', value: 'Draft work' },
                  { label: 'Action', value: selected.operation.action === 'add' ? 'Add to draft' : 'Remove from draft' },
                  { label: 'Status', value: <StatusPill status={selected.operation.status} /> },
                  {
                    label: 'Children',
                    value: `${selected.operation.parentSummary.active} pending, ${selected.operation.parentSummary.completed} done, ${selected.operation.parentSummary.failed} failed`,
                  },
                  { label: 'Progress', value: progressLabel(selected.operation.progress) },
                  { label: 'Operation', value: <code className="ui-table__mono">{selected.operation.id}</code> },
                  { label: 'Updated', value: formatRelativeDate(selected.operation.updatedAt) },
                  { label: 'Created', value: formatRelativeDate(selected.operation.createdAt) },
                ]
                : [
                  { label: 'Kind', value: 'Publication' },
                  { label: 'Status', value: <StatusPill status={selected.job.status} /> },
                  { label: 'Target version', value: String(selected.job.targetVersion) },
                  { label: 'Checkpoint', value: selected.job.checkpoint ?? 'Pending' },
                  {
                    label: 'Selection',
                    value: selected.job.selectedCount === null
                      ? 'Count pending'
                      : `${selected.job.selectedCount.toLocaleString('en-US')} selected`,
                  },
                  {
                    label: 'Confirmed unavailable',
                    value: selected.job.confirmedUnavailableCount.toLocaleString('en-US'),
                  },
                  { label: 'Updated', value: formatRelativeDate(selected.job.updatedAt) },
                  { label: 'Created', value: formatRelativeDate(selected.job.createdAt) },
                ]}
            />
            <div className="operations-detail__actions">
              {detailCollectionId && (
                <Link
                  className="operations-detail__link"
                  href={`/admin/collections/collections/${encodeURIComponent(detailCollectionId)}`}
                >
                  Open Collection
                </Link>
              )}
              {cancelButton(selected)}
            </div>
          </div>
          )}
        </ErrorBoundary>
      </Drawer>
    </AdminPage>
  )
}
