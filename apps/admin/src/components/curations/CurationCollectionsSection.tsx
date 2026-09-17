'use client'

import type { ReactNode } from 'react'
import type { CurationCollectionLink } from '../../content/record-types'
import { AdminSection } from '../ui/AdminPage'
import { Chip } from '../ui/Chip'
import { EmptyState } from '../ui/EmptyState'
import { CurationLink, type CurationNavigate } from './CurationLink'

/**
 * Collections (plan §26). The detail route keeps the duplicated `collections`
 * slug on purpose — `getCustomCollectionViewByRoute` resolves `baseRoute +
 * view.path`, so "fixing" this path is what breaks the link.
 */
export function CurationCollectionsSection({
  collections,
  navigate,
}: {
  collections: readonly CurationCollectionLink[]
  navigate?: CurationNavigate
}): ReactNode {
  return (
    <AdminSection
      title="Collections"
      description="Where this Curation is published."
      action={collections.length > 0 ? <p className="ui-section-count">{collections.length} linked</p> : undefined}
    >
      {collections.length === 0
        ? (
            <EmptyState
              title="Not in any Collection"
              description="This Curation is not part of a Collection yet, so it reaches no application."
              action={<CurationLink href="/admin/collections/collections" navigate={navigate}>Browse Collections</CurationLink>}
            />
          )
        : (
            <ul className="ui-collection-links">
              {collections.map((link) => (
                <li className="ui-collection-links__item" key={link.collection_id}>
                  <CurationLink
                    className="ui-collection-links__title"
                    href={`/admin/collections/collections/${encodeURIComponent(link.collection_id)}`}
                    navigate={navigate}
                  >
                    {link.title}
                  </CurationLink>
                  {link.current_published_version === null
                    ? <Chip size="sm" tone="muted">Not published yet</Chip>
                    : <Chip size="sm" tone="success">{`Published version ${link.current_published_version}`}</Chip>}
                </li>
              ))}
            </ul>
          )}
    </AdminSection>
  )
}
