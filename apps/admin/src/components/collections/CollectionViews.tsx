'use client'

import { useState } from 'react'
import { ActivityView, type ActivityRow } from './ActivityView'
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

const TABS: readonly CollectionTab[] = ['Overview', 'Members', 'Draft Changes', 'Versions', 'Distribution', 'Activity']

function count(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

/** Compact, keyboard-accessible Collection review shell. All lists remain paginated server reads. */
export function CollectionViews({ collection, preview = {} }: { collection: CollectionViewRecord; preview?: CollectionReadPreview }) {
  const [tab, setTab] = useState<CollectionTab>('Overview')
  const archived = collection.lifecycle === 'archived'
  const publishing = collection.draftState === 'publishing'

  return (
    <section className="collection-views" aria-labelledby="collection-title">
      <header className="collection-views__header">
        <div>
          <p className="collection-views__eyebrow">Collection</p>
          <h1 id="collection-title">{collection.title}</h1>
          <p><span>{count(collection.draftSelectedCount)} selected</span> · draft revision {collection.draftRevision}</p>
        </div>
        {archived ? (
          <button type="button">Restore collection</button>
        ) : (
          <button type="button" disabled={publishing} aria-label="Publish new version">
            {publishing ? 'Publishing…' : 'Publish new version'}
          </button>
        )}
      </header>
      {archived && <p role="status">Archived collections are read-only until restored.</p>}
      <div role="tablist" aria-label="Collection review">
        {TABS.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab} className="collection-views__panel">
        {tab === 'Overview' && <p>Published version {collection.currentPublishedVersion ?? 'not yet published'} has {count(collection.publishedSelectedCount)} selected.</p>}
        {tab === 'Members' && <MembersView items={preview.members ?? []} />}
        {tab === 'Draft Changes' && <DraftDiffView items={preview.diff ?? []} />}
        {tab === 'Versions' && <VersionsView items={preview.versions ?? []} />}
        {tab === 'Distribution' && <p>Live availability is checked at publish and distribution time.</p>}
        {tab === 'Activity' && <ActivityView items={preview.activity ?? []} />}
      </div>
    </section>
  )
}
