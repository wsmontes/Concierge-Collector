'use client'

import type { ReactNode } from 'react'
import type { CurationCollectionLink } from '../../content/record-types'
import { AdminSection } from '../ui/AdminPage'
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
    <AdminSection title="Collections" description="Where this Curation is published.">
      {collections.length === 0
        ? (
            <EmptyState
              title="Not in any Collection"
              description="This Curation is not part of a Collection yet, so it reaches no application."
            />
          )
        : (
            <ul className="curation-collections">
              {collections.map((link) => (
                <li className="curation-collections__item" key={link.collection_id}>
                  <CurationLink
                    className="curation-collections__title"
                    href={`/admin/collections/collections/${encodeURIComponent(link.collection_id)}`}
                    navigate={navigate}
                  >
                    {link.title}
                  </CurationLink>
                  <span className="curation-collections__version">
                    {link.current_published_version === null
                      ? 'Not published yet'
                      : `Published version ${link.current_published_version}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
    </AdminSection>
  )
}
