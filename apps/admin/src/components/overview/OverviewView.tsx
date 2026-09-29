'use client'

import type { ActivityRow } from '../collections/ActivityView'
import type { DraftDiffRow } from '../collections/DraftDiffView'
import type { VersionRow } from '../collections/VersionsView'

/**
 * Collection Overview aggregation tab. It is the default tab of the
 * Collection review shell and aggregates only data the cursor-paginated read
 * endpoints already returned: the Collection record (draft health and the
 * active publish lock), the first page of versions (recent publications),
 * the first page of audit events (jobs and activity) and the first page of
 * the draft diff (pending availability-relevant delta). Each row links to
 * the real destination tab through onNavigate; no component here fetches or
 * paginates by itself.
 */

export interface OverviewCollectionRecord {
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

export type OverviewTarget = 'Members' | 'Draft Changes' | 'Versions' | 'Distribution' | 'Activity'

export interface OverviewViewProps {
  collection: OverviewCollectionRecord
  versions?: readonly VersionRow[]
  activity?: readonly ActivityRow[]
  diff?: readonly DraftDiffRow[]
  onNavigate?: (target: OverviewTarget) => void
}

const DRAFT_STATE_LABEL: Record<OverviewCollectionRecord['draftState'], string> = {
  clean: 'Clean',
  dirty: 'Dirty',
  publishing: 'Publishing',
  failed: 'Failed',
}

function count(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function when(createdAt?: string): string {
  if (!createdAt) return ''
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? createdAt : date.toLocaleString()
}

function navigate(onNavigate: OverviewViewProps['onNavigate'], target: OverviewTarget) {
  return () => onNavigate?.(target)
}

/** Compact per-Collection Overview with real links to each management tab. */
export function OverviewView({ collection, versions = [], activity = [], diff = [], onNavigate }: OverviewViewProps) {
  const publishing = collection.draftState === 'publishing'
  const failed = collection.draftState === 'failed'
  const adds = diff.filter((item) => item.desiredState === 'add').length
  const removes = diff.filter((item) => item.desiredState === 'remove').length

  return (
    <div className="overview-view" aria-label="Collection overview">
      <section aria-labelledby="overview-draft">
        <h2 id="overview-draft">Draft</h2>
        <p role="status" className="overview-view__state">
          <strong>{DRAFT_STATE_LABEL[collection.draftState]}</strong> · revision {collection.draftRevision}
        </p>
        <p>{count(collection.draftSelectedCount)} selected in draft · {count(collection.publishedSelectedCount)} selected published</p>
        {failed && <p role="alert">Draft failed — review and retry.</p>}
        {publishing && <p role="status">Active publish job in progress — membership and metadata are locked.</p>}
        <button type="button" onClick={navigate(onNavigate, 'Draft Changes')}>Review draft changes</button>
      </section>

      <section aria-labelledby="overview-versions">
        <h2 id="overview-versions">Recent publications</h2>
        {versions.length === 0 ? (
          <p>No published versions yet.</p>
        ) : (
          <ul className="overview-view__list">
            {versions.slice(0, 5).map((version) => (
              <li key={version.version}>
                <button type="button" onClick={navigate(onNavigate, 'Versions')}>
                  Version {version.version} · {count(version.selectedCount)} selected · {when(version.publishedAt)}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={navigate(onNavigate, 'Versions')}>View all versions</button>
      </section>

      <section aria-labelledby="overview-activity">
        <h2 id="overview-activity">Jobs and activity</h2>
        {activity.length === 0 ? (
          <p>No recent activity.</p>
        ) : (
          <ul className="overview-view__list">
            {activity.slice(0, 5).map((event, index) => (
              <li key={`${event.createdAt}-${index}`}>{event.eventType} · {event.actorId} · {when(event.createdAt)}</li>
            ))}
          </ul>
        )}
        <button type="button" onClick={navigate(onNavigate, 'Activity')}>View activity</button>
      </section>

      <section aria-labelledby="overview-availability">
        <h2 id="overview-availability">Availability</h2>
        {diff.length === 0 ? (
          <p>No draft changes pending.</p>
        ) : (
          <p>{adds} add{adds === 1 ? '' : 's'} · {removes} remove{removes === 1 ? '' : 's'} pending in the draft.</p>
        )}
        <p>Live availability is confirmed at publish and distribution time.</p>
        <button type="button" onClick={navigate(onNavigate, 'Members')}>Review members</button>
      </section>
    </div>
  )
}
