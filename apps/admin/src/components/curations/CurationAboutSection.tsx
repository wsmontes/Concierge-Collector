'use client'

import type { ReactNode } from 'react'
import type { FieldNode } from '../../content/field-types'
import { AdminSection } from '../ui/AdminPage'
import { Chip } from '../ui/Chip'
import { EmptyState } from '../ui/EmptyState'
import { CurationLink, type CurationNavigate } from './CurationLink'
import { CurationFieldBlock, type CurationSectionEditProps } from './CurationFieldBlock'
import type { CurationEntityContext } from './curation-record-values'

/**
 * `city` and `type` are the Curation's projection of the Entity (plan §3), so
 * they are shown as facts about another record with a way to go and change them
 * there — never as a second, independent text box.
 */
function DerivedValue({
  label,
  value,
  entityId,
  navigate,
}: {
  label: string
  value: string | null
  entityId: string | null
  navigate?: CurationNavigate
}): ReactNode {
  return (
    <div className="ui-derived" data-derived="true">
      <h3 className="ui-derived__label">{label}</h3>
      <p className="ui-derived__value">{value ?? 'Not set'}</p>
      <p className="ui-derived__source">Derived from Entity</p>
      {entityId !== null && (
        <CurationLink
          className="ui-derived__link"
          href={`/admin/entities/${encodeURIComponent(entityId)}`}
          navigate={navigate}
        >
          Edit Entity →
        </CurationLink>
      )}
    </div>
  )
}

/** About (plan §14, §23): the Entity as factual context, the working name as the Curation's own. */
export function CurationAboutSection({
  entity,
  restaurantNode,
  edit,
  navigate,
}: {
  entity: CurationEntityContext
  restaurantNode: FieldNode | null
  edit: CurationSectionEditProps
  navigate?: CurationNavigate
}): ReactNode {
  const facts: string[] = []
  if (entity.type !== null) facts.push(entity.type)
  if (entity.city !== null) facts.push(entity.city)

  return (
    <AdminSection title="About" description="What this Curation is about, and which record owns its factual data.">
      <div className="ui-about">
        {entity.entityId === null
          ? (
              <EmptyState
                title="No Entity linked"
                description="Until an Entity is linked, the restaurant name below is this Curation's working name."
                action={
                  <CurationLink className="ui-about__action" href="/admin/entities" navigate={navigate}>
                    Find and link Entity
                  </CurationLink>
                }
              />
            )
          : (
              <div className="ui-about__entity">
                <div className="ui-about__headline">
                  <h3 className="ui-about__name">{entity.name ?? 'Linked Entity'}</h3>
                  <Chip size="sm" tone="accent">Linked Entity</Chip>
                </div>
                {entity.name === null && (
                  <p className="ui-about__secondary ui-detail-mono">Entity id {entity.entityId}</p>
                )}
                {facts.length > 0 && <p className="ui-about__facts">{facts.join(' · ')}</p>}
                <CurationLink
                  className="ui-about__action"
                  href={`/admin/entities/${encodeURIComponent(entity.entityId)}`}
                  navigate={navigate}
                >
                  View Entity →
                </CurationLink>
              </div>
            )}
        {restaurantNode !== null && <CurationFieldBlock node={restaurantNode} edit={edit} />}
        <div className="ui-about__derived">
          <DerivedValue label="City" value={entity.city} entityId={entity.entityId} navigate={navigate} />
          <DerivedValue label="Type" value={entity.type} entityId={entity.entityId} navigate={navigate} />
        </div>
      </div>
    </AdminSection>
  )
}
