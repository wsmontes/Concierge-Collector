'use client'

import type { ReactNode } from 'react'
import type { FieldNode } from '../../content/field-types'
import { AdminSection } from '../ui/AdminPage'
import { EmptyState } from '../ui/EmptyState'
import { CurationFieldBlock, type CurationSectionEditProps } from './CurationFieldBlock'

/**
 * Your curation (plan §15, §32): the editorial fields, read first and edited one
 * block at a time. `items` and the notes are the blocks; anything the registry
 * does not place here is still reachable — All fields is the guarantor.
 */
export function CurationEditorialSection({
  nodes,
  edit,
}: {
  nodes: FieldNode[]
  edit: CurationSectionEditProps
}): ReactNode {
  return (
    <AdminSection title="Your curation" description="The curator's own words. Clicking Edit turns one block into a form.">
      {nodes.length === 0
        ? (
            <EmptyState
              title="No editorial fields"
              description="This record stores none of the editorial fields the registry describes."
            />
          )
        : (
            <div className="curation-editorial">
              {nodes.map((node) => <CurationFieldBlock key={node.path} node={node} edit={edit} />)}
            </div>
          )}
      <p className="curation-editorial__hint">
        Fields outside this editorial set — including keys the field registry does not describe — stay editable in All fields.
      </p>
    </AdminSection>
  )
}
