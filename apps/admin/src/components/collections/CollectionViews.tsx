'use client'

import { Button } from '@payloadcms/ui'
import Link from 'next/link'
import { useState } from 'react'
import type { CollectionDistributionClient } from '../../collections/distribution-client'
import { InlineNotice } from '../ui/InlineNotice'
import { StatusPill } from '../ui/StatusPill'
import { ActivityView, type ActivityRow } from './ActivityView'
import { CollectionDistributionView } from './CollectionDistributionView'
import { DraftDiffView, type DraftDiffRow } from './DraftDiffView'
import { MembersView, type MemberRow } from './MembersView'
import { VersionsView, type VersionRow } from './VersionsView'
import { OverviewView } from '../overview/OverviewView'

export interface CollectionViewRecord {
  id: string
  title: string
  lifecycle: 'draft' | 'published' | 'archived'
  draftState: 'clean' | 'dirty' | 'publishing' | 'failed'
  currentPublishedVersion?: number | null
  draftRevision: number
  revision: number
  publishedSelectedCount: number
  draftSelectedCount: number
}

export type CollectionTab = 'Overview' | 'Members' | 'Draft Changes' | 'Versions' | 'Distribution' | 'Activity'

export interface CollectionReadPreview {
  activity?: ActivityRow[]
  diff?: DraftDiffRow[]
  members?: MemberRow[]
  versions?: VersionRow[]
}

export interface CollectionPaginationPreview {
  activity?: { hasMore: boolean; loading?: boolean }
  diff?: { hasMore: boolean; loading?: boolean }
  members?: { hasMore: boolean; loading?: boolean }
  versions?: { hasMore: boolean; loading?: boolean }
}

export interface CollectionViewActions {
  onArchive?: () => void
  onEditMetadata?: () => void
  onLoadMoreActivity?: () => void
  onLoadMoreDiff?: () => void
  onLoadMoreMembers?: () => void
  onLoadMoreVersions?: () => void
  onPublish?: () => void
  onRestore?: () => void
  onRestoreVersionAsDraft?: (version: number) => void
}

const TABS: readonly CollectionTab[] = ['Overview', 'Members', 'Draft Changes', 'Versions', 'Distribution', 'Activity']

function count(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

/** Compact, keyboard-accessible Collection review shell. All lists remain paginated server reads. */
export function CollectionViews({
  collection,
  preview = {},
  pagination = {},
  actions = {},
  distributionClient,
}: {
  collection: CollectionViewRecord
  preview?: CollectionReadPreview
  pagination?: CollectionPaginationPreview
  actions?: CollectionViewActions
  distributionClient?: CollectionDistributionClient
}) {
  const [tab, setTab] = useState<CollectionTab>('Overview')
  const archived = collection.lifecycle === 'archived'
  const publishing = collection.draftState === 'publishing'

  return (
    <section className="collection-views" aria-labelledby="collection-title">
      <header className="collection-views__header">
        <div className="collection-views__identity">
          <p className="collection-views__eyebrow">Collection</p>
          <h1 id="collection-title">{collection.title}</h1>
          <div className="collection-views__status" aria-label="Collection status">
            <StatusPill status={collection.lifecycle} label={collection.lifecycle} />
            <StatusPill status={collection.draftState} label={collection.draftState} />
            <span>{count(collection.draftSelectedCount)} selected</span>
            <span>draft revision {collection.draftRevision}</span>
          </div>
        </div>
        <div className="collection-views__actions">
          {archived ? (
            <Button margin={false} onClick={actions.onRestore} type="button">Restore collection</Button>
          ) : <>
            <Link className="collection-views__link-button" href={`/admin/explorer?collection=${encodeURIComponent(collection.id)}`}>
              Add Curations
            </Link>
            <Button buttonStyle="secondary" margin={false} onClick={actions.onEditMetadata} type="button">Edit metadata</Button>
            <Button buttonStyle="secondary" margin={false} onClick={actions.onArchive} type="button">Archive collection</Button>
            <Button
              disabled={publishing}
              margin={false}
              aria-label="Publish new version"
              onClick={actions.onPublish}
              type="button"
            >
              {publishing ? 'Publishing…' : 'Publish new version'}
            </Button>
          </>}
        </div>
      </header>
      {archived && (
        <InlineNotice tone="warning">
          <p>Archived collections are read-only until restored.</p>
        </InlineNotice>
      )}
      <div role="tablist" aria-label="Collection review" className="collection-views__tabs">
        {TABS.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab} className="collection-views__panel">
        {tab === 'Overview' && <OverviewView
          collection={collection}
          versions={preview.versions ?? []}
          activity={preview.activity ?? []}
          diff={preview.diff ?? []}
          onNavigate={setTab}
        />}
        {tab === 'Members' && <MembersView
          items={preview.members ?? []}
          hasMore={pagination.members?.hasMore}
          loading={pagination.members?.loading}
          onLoadMore={actions.onLoadMoreMembers}
        />}
        {tab === 'Draft Changes' && <DraftDiffView
          items={preview.diff ?? []}
          hasMore={pagination.diff?.hasMore}
          loading={pagination.diff?.loading}
          onLoadMore={actions.onLoadMoreDiff}
        />}
        {tab === 'Versions' && <VersionsView
          items={preview.versions ?? []}
          currentPublishedVersion={collection.currentPublishedVersion}
          hasMore={pagination.versions?.hasMore}
          loading={pagination.versions?.loading}
          onLoadMore={actions.onLoadMoreVersions}
          onRestoreAsDraft={actions.onRestoreVersionAsDraft}
        />}
        {tab === 'Distribution' && <CollectionDistributionView
          collectionId={collection.id}
          lifecycle={collection.lifecycle}
          currentPublishedVersion={collection.currentPublishedVersion}
          client={distributionClient}
        />}
        {tab === 'Activity' && <ActivityView
          items={preview.activity ?? []}
          hasMore={pagination.activity?.hasMore}
          loading={pagination.activity?.loading}
          onLoadMore={actions.onLoadMoreActivity}
        />}
      </div>
    </section>
  )
}
