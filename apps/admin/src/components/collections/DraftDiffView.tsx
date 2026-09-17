import { Button } from '@payloadcms/ui'
import type { AdminCurationRow } from '../../explorer/types'
import { AdminSection } from '../ui/AdminPage'
import { CurationIdentity } from './CurationIdentity'
import { TechnicalDetails } from './TechnicalDetails'

/** One pending draft change: the Curation it touches, why, and by which operation. */
export interface DraftDiffRow {
  curationId: string
  desiredState: 'add' | 'remove'
  operationId: string
  summary: AdminCurationRow | null
}

export interface DraftDiffViewProps {
  items: readonly DraftDiffRow[]
  hasMore?: boolean
  loading?: boolean
  onLoadMore?: () => void
}

const GROUPS: readonly { state: DraftDiffRow['desiredState']; label: string; sign: string; empty: string }[] = [
  { state: 'add', label: 'ADDED', sign: '+', empty: 'No additions pending.' },
  { state: 'remove', label: 'REMOVED', sign: '−', empty: 'No removals pending.' },
]

/**
 * The pending draft changes of one Collection, grouped as ADDED and REMOVED
 * (§25).
 *
 * Each row reads as an editorial decision — the restaurant, its curator, its
 * place and its concepts — instead of a bare id; the ids and the `operationId`
 * that linked the change stay inside the collapsed disclosure. The direction is
 * stated twice — a word (ADDED/REMOVED) and a leading `+`/`−` — so it never
 * depends on the color of a border.
 */
export function DraftDiffView({ items, hasMore = false, loading = false, onLoadMore }: DraftDiffViewProps) {
  return (
    <AdminSection
      description="Pending additions and removals in the draft. Nothing here is published until a new version is created."
      title="Draft changes"
    >
      <div className="collection-draft-diff">
        {GROUPS.map((group) => {
          const rows = items.filter((item) => item.desiredState === group.state)
          return (
            <section className="collection-draft-diff__group" data-tone={group.state} key={group.state}>
              <h3 className="collection-draft-diff__heading">
                {group.label}
                <span className="collection-draft-diff__count">{rows.length.toLocaleString('en-US')}</span>
              </h3>
              {rows.length === 0
                ? <p className="collection-draft-diff__empty">{group.empty}</p>
                : (
                  <ul aria-label={`Draft changes ${group.label}`} className="collection-draft-diff__list">
                    {rows.map((row) => (
                      <li className="collection-draft-diff__row" data-tone={group.state} key={row.curationId}>
                        <span className="collection-draft-diff__sign">{group.sign}</span>
                        <CurationIdentity curationId={row.curationId} summary={row.summary} />
                        <TechnicalDetails details={[
                          // A row with no catalog summary already shows its id as the
                          // identity; the disclosure then carries only the change.
                          ...(row.summary ? [{ term: 'Curation id', value: row.curationId }] : []),
                          { term: 'Desired state', value: row.desiredState },
                          { term: 'Operation id', value: row.operationId },
                        ]} />
                      </li>
                    ))}
                  </ul>
                )}
            </section>
          )
        })}
        {hasMore && onLoadMore && (
          <div className="collection-view__more">
            <Button buttonStyle="secondary" disabled={loading} margin={false} onClick={onLoadMore} type="button">
              {loading ? 'Loading more…' : 'Load more draft changes'}
            </Button>
          </div>
        )}
      </div>
    </AdminSection>
  )
}
