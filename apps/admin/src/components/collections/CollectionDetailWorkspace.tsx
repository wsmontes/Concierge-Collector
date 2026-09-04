'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CollectionsAdminError,
  createBrowserCollectionsAdminClient,
  type ActivityRowDto,
  type AdminCollectionRecord,
  type CollectionsAdminClient,
  type DraftDiffRowDto,
  type MemberRowDto,
  type PublishPreviewDto,
  type VersionRowDto,
} from '../../collections/admin-client'
import { CollectionMetadataForm } from './CollectionMetadataForm'
import { CollectionViews } from './CollectionViews'
import { PublishCollectionDialog } from './PublishCollectionDialog'

const browserCollectionsClient = createBrowserCollectionsAdminClient()
const PUBLISH_POLL_MS = 1_000
const PUBLISH_TIMEOUT_MS = 150_000

interface PageState<T> {
  items: T[]
  nextCursor: string | null
  loading: boolean
  error: string | null
}

type LifecycleConfirmation = 'archive' | 'restore' | null

function emptyPage<T>(): PageState<T> {
  return { items: [], nextCursor: null, loading: false, error: null }
}

function humanError(error: unknown): string {
  if (error instanceof CollectionsAdminError) {
    if (error.status === 401) return 'Your Admin session has expired.'
    if (error.status === 403) return 'Admin access is required.'
    if (error.status === 404) return 'Collection not found.'
    if (error.status === 423) return 'Publication in progress. Collection changes are temporarily locked.'
    if (error.status === 503) return 'Collections service is unavailable.'
    return error.code
  }
  return error instanceof Error ? error.message : 'request_failed'
}

function isRevisionConflict(error: unknown): error is CollectionsAdminError {
  return error instanceof CollectionsAdminError && (error.status === 409 || error.status === 412)
}

function pageFrom<T>(value: { items: T[]; nextCursor: string | null }): PageState<T> {
  return { items: value.items, nextCursor: value.nextCursor, loading: false, error: null }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm
}

function LifecycleConfirmationDialog({
  kind,
  pending,
  onCancel,
  onConfirm,
}: {
  kind: Exclude<LifecycleConfirmation, null>
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const archive = kind === 'archive'
  const title = archive ? 'Archive Collection' : 'Restore Collection'
  return <div className="collection-dialog-backdrop" role="presentation">
    <section aria-labelledby="collection-lifecycle-title" aria-modal="true" className="collection-dialog" role="dialog">
      <header className="collection-dialog__header">
        <h2 id="collection-lifecycle-title">{title}</h2>
      </header>
      <p>{archive
        ? 'Archiving is an external kill switch: this Collection becomes unavailable to distribution immediately.'
        : 'Restoring returns this Collection to published state using exactly the same current published version.'}</p>
      <footer className="collection-dialog__footer">
        <button type="button" onClick={onCancel} disabled={pending}>Cancel</button>
        <button type="button" onClick={onConfirm} disabled={pending}>
          {pending ? 'Working…' : archive ? 'Confirm archive' : 'Confirm restore'}
        </button>
      </footer>
    </section>
  </div>
}

function HistoricalRestoreDialog({
  version,
  pending,
  onCancel,
  onConfirm,
}: {
  version: number
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return <div className="collection-dialog-backdrop" role="presentation">
    <section
      aria-labelledby="historical-restore-title"
      aria-modal="true"
      className="collection-dialog"
      role="dialog"
    >
      <header className="collection-dialog__header">
        <h2 id="historical-restore-title">Restore version {version} as draft</h2>
      </header>
      <p>
        This compares version {version} with the currently published membership and enqueues the difference as draft changes.
        The published pointer does not move until you publish a new version.
      </p>
      <footer className="collection-dialog__footer">
        <button type="button" onClick={onCancel} disabled={pending}>Cancel</button>
        <button type="button" onClick={onConfirm} disabled={pending}>
          {pending ? 'Queuing…' : 'Confirm restore as draft'}
        </button>
      </footer>
    </section>
  </div>
}

export interface CollectionDetailWorkspaceProps {
  collectionId: string
  client?: CollectionsAdminClient
}

export function CollectionDetailWorkspace({
  collectionId,
  client = browserCollectionsClient,
}: CollectionDetailWorkspaceProps) {
  const [collection, setCollection] = useState<AdminCollectionRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<PageState<MemberRowDto>>(() => emptyPage<MemberRowDto>())
  const [diff, setDiff] = useState<PageState<DraftDiffRowDto>>(() => emptyPage<DraftDiffRowDto>())
  const [versions, setVersions] = useState<PageState<VersionRowDto>>(() => emptyPage<VersionRowDto>())
  const [activity, setActivity] = useState<PageState<ActivityRowDto>>(() => emptyPage<ActivityRowDto>())
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [lifecycleConfirmation, setLifecycleConfirmation] = useState<LifecycleConfirmation>(null)
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null)
  const [publishPreview, setPublishPreview] = useState<PublishPreviewDto | null>(null)
  const [publishPreviewLoading, setPublishPreviewLoading] = useState(false)
  const [publishPending, setPublishPending] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [commandPending, setCommandPending] = useState(false)
  const [commandNotice, setCommandNotice] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const current = await client.get(collectionId)
      setCollection(current)
      const [membersPage, diffPage, versionsPage, activityPage] = await Promise.all([
        current.currentPublishedVersion
          ? client.members(collectionId, current.currentPublishedVersion, undefined)
          : Promise.resolve({ items: [] as MemberRowDto[], nextCursor: null }),
        client.draftDiff(collectionId, undefined),
        client.versions(collectionId, undefined),
        client.activity(collectionId, undefined),
      ])
      setMembers(pageFrom(membersPage))
      setDiff(pageFrom(diffPage))
      setVersions(pageFrom(versionsPage))
      setActivity(pageFrom(activityPage))
    } catch (cause) {
      setError(humanError(cause))
    } finally {
      setLoading(false)
    }
  }, [client, collectionId])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  async function refreshReadModels(current: AdminCollectionRecord) {
    const [membersPage, diffPage, versionsPage, activityPage] = await Promise.all([
      current.currentPublishedVersion
        ? client.members(collectionId, current.currentPublishedVersion, undefined)
        : Promise.resolve({ items: [] as MemberRowDto[], nextCursor: null }),
      client.draftDiff(collectionId, undefined),
      client.versions(collectionId, undefined),
      client.activity(collectionId, undefined),
    ])
    setMembers(pageFrom(membersPage))
    setDiff(pageFrom(diffPage))
    setVersions(pageFrom(versionsPage))
    setActivity(pageFrom(activityPage))
  }

  async function reloadLatestAfterConflict() {
    const latest = await client.get(collectionId)
    setCollection(latest)
    setMetadataOpen(false)
    setLifecycleConfirmation(null)
    setPublishPreview(null)
    setCommandNotice('Collection changed on the server. The latest state has been reloaded.')
    return latest
  }

  async function saveMetadata(input: { title: string; description: string | null }) {
    if (!collection) return
    setCommandError(null)
    setCommandNotice(null)
    try {
      const updated = await client.patchMetadata(collection, input)
      setCollection(updated)
      setMetadataOpen(false)
      setCommandNotice('Collection metadata updated.')
    } catch (cause) {
      if (isRevisionConflict(cause)) {
        await reloadLatestAfterConflict()
        return
      }
      const message = humanError(cause)
      setCommandError(message)
      throw new Error(message)
    }
  }

  async function runLifecycle(kind: Exclude<LifecycleConfirmation, null>) {
    if (!collection || commandPending) return
    setCommandPending(true)
    setCommandError(null)
    setCommandNotice(null)
    try {
      const updated = kind === 'archive'
        ? await client.archive(collection)
        : await client.restore(collection)
      setCollection(updated)
      setLifecycleConfirmation(null)
      setCommandNotice(kind === 'archive' ? 'Collection archived.' : 'Collection restored.')
    } catch (cause) {
      if (isRevisionConflict(cause)) {
        await reloadLatestAfterConflict()
      } else {
        setCommandError(humanError(cause))
      }
    } finally {
      setCommandPending(false)
    }
  }

  async function openPublish() {
    if (!collection || publishPreviewLoading) return
    setPublishPreviewLoading(true)
    setPublishError(null)
    setCommandError(null)
    setCommandNotice(null)
    try {
      const preview = await client.publishPreview(collectionId)
      if (preview.revision !== collection.revision) {
        await reloadLatestAfterConflict()
        return
      }
      setPublishPreview(preview)
    } catch (cause) {
      setCommandError(humanError(cause))
    } finally {
      setPublishPreviewLoading(false)
    }
  }

  async function waitForPromotion(targetVersion: number): Promise<AdminCollectionRecord> {
    const deadline = Date.now() + PUBLISH_TIMEOUT_MS
    while (Date.now() < deadline) {
      const latest = await client.get(collectionId)
      setCollection(latest)
      if (latest.currentPublishedVersion === targetVersion && latest.draftState === 'clean') return latest
      if (latest.draftState === 'failed') throw new Error('Publication failed. Review activity before retrying.')
      await sleep(PUBLISH_POLL_MS)
    }
    throw new Error('Publication is still running. Check Operations for current status.')
  }

  async function confirmPublish() {
    if (!collection || !publishPreview || publishPending) return
    const preview = publishPreview
    setPublishPending(true)
    setPublishError(null)
    setCommandError(null)
    setCommandNotice(null)
    try {
      await client.publish(collection, {
        confirmUnavailable: preview.unavailableCount > 0,
        ...(preview.unavailableCount > 0 ? { expectedUnavailableCount: preview.unavailableCount } : {}),
      })
      setPublishPreview(null)
      setCommandNotice('Publication queued.')
      const promoted = await waitForPromotion(preview.nextVersion)
      await refreshReadModels(promoted)
      setCommandNotice(`Published version ${preview.nextVersion}.`)
    } catch (cause) {
      if (cause instanceof CollectionsAdminError && cause.code === 'unavailable_confirmation_required') {
        try {
          const freshPreview = await client.publishPreview(collectionId)
          setPublishPreview(freshPreview)
          setPublishError('Availability changed since the preview. Review the current counts before publishing.')
        } catch (previewCause) {
          setCommandError(humanError(previewCause))
        }
      } else if (isRevisionConflict(cause)) {
        await reloadLatestAfterConflict()
      } else {
        setPublishError(humanError(cause))
      }
    } finally {
      setPublishPending(false)
    }
  }

  async function confirmHistoricalRestore() {
    if (restoreVersion === null || commandPending) return
    const version = restoreVersion
    setCommandPending(true)
    setCommandError(null)
    setCommandNotice(null)
    try {
      const result = await client.restoreVersionAsDraft(collectionId, version)
      const addedCount = Number(result.addedCount ?? 0)
      const removedCount = Number(result.removedCount ?? 0)
      const latest = await client.get(collectionId)
      setCollection(latest)
      const [diffPage, activityPage] = await Promise.all([
        client.draftDiff(collectionId, undefined),
        client.activity(collectionId, undefined),
      ])
      setDiff(pageFrom(diffPage))
      setActivity(pageFrom(activityPage))
      setRestoreVersion(null)
      setCommandNotice(
        `Version ${version} queued as draft changes: ${addedCount} ${plural(addedCount, 'add')}, ${removedCount} ${plural(removedCount, 'remove')}.`,
      )
    } catch (cause) {
      setCommandError(humanError(cause))
    } finally {
      setCommandPending(false)
    }
  }

  async function loadMoreMembers() {
    if (!collection?.currentPublishedVersion || !members.nextCursor || members.loading) return
    setMembers((current) => ({ ...current, loading: true, error: null }))
    try {
      const next = await client.members(collectionId, collection.currentPublishedVersion, members.nextCursor)
      setMembers((current) => ({
        items: [...current.items, ...next.items],
        nextCursor: next.nextCursor,
        loading: false,
        error: null,
      }))
    } catch (cause) {
      setMembers((current) => ({ ...current, loading: false, error: humanError(cause) }))
    }
  }

  async function loadMoreDiff() {
    if (!diff.nextCursor || diff.loading) return
    setDiff((current) => ({ ...current, loading: true, error: null }))
    try {
      const next = await client.draftDiff(collectionId, diff.nextCursor)
      setDiff((current) => ({
        items: [...current.items, ...next.items],
        nextCursor: next.nextCursor,
        loading: false,
        error: null,
      }))
    } catch (cause) {
      setDiff((current) => ({ ...current, loading: false, error: humanError(cause) }))
    }
  }

  async function loadMoreVersions() {
    if (!versions.nextCursor || versions.loading) return
    setVersions((current) => ({ ...current, loading: true, error: null }))
    try {
      const next = await client.versions(collectionId, versions.nextCursor)
      setVersions((current) => ({
        items: [...current.items, ...next.items],
        nextCursor: next.nextCursor,
        loading: false,
        error: null,
      }))
    } catch (cause) {
      setVersions((current) => ({ ...current, loading: false, error: humanError(cause) }))
    }
  }

  async function loadMoreActivity() {
    if (!activity.nextCursor || activity.loading) return
    setActivity((current) => ({ ...current, loading: true, error: null }))
    try {
      const next = await client.activity(collectionId, activity.nextCursor)
      setActivity((current) => ({
        items: [...current.items, ...next.items],
        nextCursor: next.nextCursor,
        loading: false,
        error: null,
      }))
    } catch (cause) {
      setActivity((current) => ({ ...current, loading: false, error: humanError(cause) }))
    }
  }

  if (loading && !collection) {
    return <main className="collection-views"><p role="status">Loading Collection…</p></main>
  }

  if (error && !collection) {
    return <main className="collection-views">
      <p role="alert">{error}</p>
      <button type="button" onClick={() => void loadInitial()}>Try again</button>
    </main>
  }

  if (!collection) return null

  return <>
    <CollectionViews
      collection={collection}
      preview={{
        members: members.items,
        diff: diff.items,
        versions: versions.items,
        activity: activity.items,
      }}
      pagination={{
        members: { hasMore: Boolean(members.nextCursor), loading: members.loading },
        diff: { hasMore: Boolean(diff.nextCursor), loading: diff.loading },
        versions: { hasMore: Boolean(versions.nextCursor), loading: versions.loading },
        activity: { hasMore: Boolean(activity.nextCursor), loading: activity.loading },
      }}
      actions={{
        onEditMetadata: () => setMetadataOpen(true),
        onArchive: () => setLifecycleConfirmation('archive'),
        onRestore: () => setLifecycleConfirmation('restore'),
        onPublish: () => void openPublish(),
        onRestoreVersionAsDraft: setRestoreVersion,
        onLoadMoreMembers: () => void loadMoreMembers(),
        onLoadMoreDiff: () => void loadMoreDiff(),
        onLoadMoreVersions: () => void loadMoreVersions(),
        onLoadMoreActivity: () => void loadMoreActivity(),
      }}
    />
    {publishPreviewLoading && <p className="collection-views" role="status">Checking publish availability…</p>}
    {commandNotice && <p className="collection-views" role="status">{commandNotice}</p>}
    {commandError && <p className="collection-views" role="alert">{commandError}</p>}
    {members.error && <p className="collection-views" role="alert">Members: {members.error}</p>}
    {diff.error && <p className="collection-views" role="alert">Draft changes: {diff.error}</p>}
    {versions.error && <p className="collection-views" role="alert">Versions: {versions.error}</p>}
    {activity.error && <p className="collection-views" role="alert">Activity: {activity.error}</p>}
    {metadataOpen && <CollectionMetadataForm
      collection={collection}
      onCancel={() => setMetadataOpen(false)}
      onSave={saveMetadata}
    />}
    {lifecycleConfirmation && <LifecycleConfirmationDialog
      kind={lifecycleConfirmation}
      pending={commandPending}
      onCancel={() => setLifecycleConfirmation(null)}
      onConfirm={() => void runLifecycle(lifecycleConfirmation)}
    />}
    {publishPreview && <PublishCollectionDialog
      preview={publishPreview}
      pending={publishPending}
      error={publishError}
      onCancel={() => { if (!publishPending) setPublishPreview(null) }}
      onConfirm={() => void confirmPublish()}
    />}
    {restoreVersion !== null && <HistoricalRestoreDialog
      version={restoreVersion}
      pending={commandPending}
      onCancel={() => setRestoreVersion(null)}
      onConfirm={() => void confirmHistoricalRestore()}
    />}
  </>
}
