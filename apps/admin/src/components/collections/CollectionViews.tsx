'use client'

import { Button } from '@payloadcms/ui'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import type { CollectionDistributionClient } from '../../collections/distribution-client'
import type { LoadCurationRecord } from '../../content/record-types'
import { OverviewView } from '../overview/OverviewView'
import { AdminPage } from '../ui/AdminPage'
import { Chip, statusTone } from '../ui/Chip'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { InlineNotice } from '../ui/InlineNotice'
import { StatusPill } from '../ui/StatusPill'
import { Tabs, type TabSpec } from '../ui/Tabs'
import { ActivityView, type ActivityRow } from './ActivityView'
import { CollectionDistributionView } from './CollectionDistributionView'
import { CollectionRelationships } from './CollectionRelationships'
import { DraftDiffView, type DraftDiffRow } from './DraftDiffView'
import { MembersView, type MemberRow } from './MembersView'
import { VersionsView, type VersionRow } from './VersionsView'

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

/* O `id` é slug porque vira parte do `id` do DOM (uma aba com espaço no id é
   inválido); o `label` é o nome acessível que os testes e a E2E leem. */
const TABS: Array<{ id: string; label: CollectionTab }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'members', label: 'Members' },
  { id: 'draft-changes', label: 'Draft Changes' },
  { id: 'versions', label: 'Versions' },
  { id: 'distribution', label: 'Distribution' },
  { id: 'activity', label: 'Activity' },
]

/**
 * The Collection review shell: identity and actions at the top, then the tabs
 * that read the cursor endpoints.
 *
 * Everything here is presentational — the caller owns the reads, the commands and
 * the notices it passes in — and the tab strip is the kit `Tabs` (WAI-ARIA
 * tablist with arrow/Home/End keys) instead of a hand-rolled button row.
 */
export function CollectionViews({
  collection,
  preview = {},
  pagination = {},
  actions = {},
  distributionClient,
  loadRecord,
  notices,
}: {
  collection: CollectionViewRecord
  preview?: CollectionReadPreview
  pagination?: CollectionPaginationPreview
  actions?: CollectionViewActions
  distributionClient?: CollectionDistributionClient
  /** Loader of one Curation record for the member preview; the browser BFF one by default. */
  loadRecord?: LoadCurationRecord
  /** Avisos e erros de comando da página, logo abaixo do cabeçalho. */
  notices?: ReactNode
}) {
  const [tab, setTab] = useState<CollectionTab>('Overview')
  const archived = collection.lifecycle === 'archived'
  const publishing = collection.draftState === 'publishing'
  const activeId = TABS.find((entry) => entry.label === tab)?.id ?? TABS[0].id

  const tabs: TabSpec[] = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <OverviewView
          activity={preview.activity ?? []}
          collection={collection}
          diff={preview.diff ?? []}
          onNavigate={setTab}
          versions={preview.versions ?? []}
        />
      ),
    },
    {
      id: 'members',
      label: 'Members',
      content: (
        <MembersView
          collectionId={collection.id}
          hasMore={pagination.members?.hasMore}
          items={preview.members ?? []}
          loadRecord={loadRecord}
          loading={pagination.members?.loading}
          onLoadMore={actions.onLoadMoreMembers}
        />
      ),
    },
    {
      id: 'draft-changes',
      label: 'Draft Changes',
      content: (
        <DraftDiffView
          hasMore={pagination.diff?.hasMore}
          items={preview.diff ?? []}
          loading={pagination.diff?.loading}
          onLoadMore={actions.onLoadMoreDiff}
        />
      ),
    },
    {
      id: 'versions',
      label: 'Versions',
      content: (
        <VersionsView
          currentPublishedVersion={collection.currentPublishedVersion}
          hasMore={pagination.versions?.hasMore}
          items={preview.versions ?? []}
          loading={pagination.versions?.loading}
          onLoadMore={actions.onLoadMoreVersions}
          onRestoreAsDraft={actions.onRestoreVersionAsDraft}
        />
      ),
    },
    {
      id: 'distribution',
      label: 'Distribution',
      content: (
        <CollectionDistributionView
          client={distributionClient}
          collectionId={collection.id}
          currentPublishedVersion={collection.currentPublishedVersion}
          lifecycle={collection.lifecycle}
        />
      ),
    },
    {
      id: 'activity',
      label: 'Activity',
      content: (
        <ActivityView
          hasMore={pagination.activity?.hasMore}
          items={preview.activity ?? []}
          loading={pagination.activity?.loading}
          onLoadMore={actions.onLoadMoreActivity}
        />
      ),
    },
  ]

  return (
    <AdminPage
      actions={archived ? (
        <Button margin={false} onClick={actions.onRestore} type="button">Restore collection</Button>
      ) : (
        <>
          <Link
            className="collections-link-button"
            href={`/admin/curations?collection=${encodeURIComponent(collection.id)}`}
          >
            Add Curations
          </Link>
          <Button buttonStyle="secondary" margin={false} onClick={actions.onEditMetadata} type="button">
            Edit metadata
          </Button>
          <Button buttonStyle="secondary" margin={false} onClick={actions.onArchive} type="button">
            Archive collection
          </Button>
          <Button
            aria-label="Publish new version"
            disabled={publishing}
            margin={false}
            onClick={actions.onPublish}
            type="button"
          >
            {publishing ? 'Publishing…' : 'Publish new version'}
          </Button>
        </>
      )}
      breadcrumb={[{ href: '/admin/collections/collections', label: 'Collections' }]}
      eyebrow="Collection"
      sticky
      title={collection.title}
      width="wide"
    >
      <div aria-label="Collection status" className="ui-chip-group" role="group">
        <StatusPill label={collection.lifecycle} status={collection.lifecycle} />
        <StatusPill label={collection.draftState} status={collection.draftState} />
        <Chip size="sm" tone={statusTone(collection.draftState)} title="Curations selected in the draft">
          {collection.draftSelectedCount.toLocaleString('en-US')} selected
        </Chip>
        <Chip size="sm" title="Revision of the pending draft">
          draft revision {collection.draftRevision.toLocaleString('en-US')}
        </Chip>
      </div>

      {notices}

      {archived && (
        <InlineNotice tone="warning">
          <p>Archived collections are read-only until restored.</p>
        </InlineNotice>
      )}

      <CollectionRelationships
        hasMore={pagination.members?.hasMore ?? false}
        members={preview.members ?? []}
      />

      {/* `Tabs` é não-controlado no kit: a navegação vinda do Overview pede uma
          aba, e a identidade (`key`) é o que remonta o strip no pedido novo.
          A fronteira de erro fica aqui porque as seis abas leem dado remoto: uma
          linha malformada derruba um painel, não o Admin inteiro. */}
      <ErrorBoundary title="This Collection panel could not be displayed">
        <Tabs
          defaultTabId={activeId}
          key={activeId}
          label="Collection review"
          tabs={tabs}
        />
      </ErrorBoundary>
    </AdminPage>
  )
}
