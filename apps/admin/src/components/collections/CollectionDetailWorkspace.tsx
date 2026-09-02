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
  type VersionRowDto,
} from '../../collections/admin-client'
import { CollectionViews } from './CollectionViews'

const browserCollectionsClient = createBrowserCollectionsAdminClient()

interface PageState<T> {
  items: T[]
  nextCursor: string | null
  loading: boolean
  error: string | null
}

function emptyPage<T>(): PageState<T> {
  return { items: [], nextCursor: null, loading: false, error: null }
}

function humanError(error: unknown): string {
  if (error instanceof CollectionsAdminError) {
    if (error.status === 401) return 'Your Admin session has expired.'
    if (error.status === 403) return 'Admin access is required.'
    if (error.status === 404) return 'Collection not found.'
    if (error.status === 503) return 'Collections service is unavailable.'
    return error.code
  }
  return error instanceof Error ? error.message : 'request_failed'
}

function pageFrom<T>(value: { items: T[]; nextCursor: string | null }): PageState<T> {
  return { items: value.items, nextCursor: value.nextCursor, loading: false, error: null }
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
  const [members, setMembers] = useState<PageState<MemberRowDto>>(emptyPage)
  const [diff, setDiff] = useState<PageState<DraftDiffRowDto>>(emptyPage)
  const [versions, setVersions] = useState<PageState<VersionRowDto>>(emptyPage)
  const [activity, setActivity] = useState<PageState<ActivityRowDto>>(emptyPage)

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
        onLoadMoreMembers: () => void loadMoreMembers(),
        onLoadMoreDiff: () => void loadMoreDiff(),
        onLoadMoreVersions: () => void loadMoreVersions(),
        onLoadMoreActivity: () => void loadMoreActivity(),
      }}
    />
    {members.error && <p className="collection-views" role="alert">Members: {members.error}</p>}
    {diff.error && <p className="collection-views" role="alert">Draft changes: {diff.error}</p>}
    {versions.error && <p className="collection-views" role="alert">Versions: {versions.error}</p>}
    {activity.error && <p className="collection-views" role="alert">Activity: {activity.error}</p>}
  </>
}
