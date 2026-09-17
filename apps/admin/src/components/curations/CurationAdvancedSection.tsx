'use client'

import type { ReactNode } from 'react'
import type { FieldNode } from '../../content/field-types'
import { AdminSection } from '../ui/AdminPage'
import { EmptyState } from '../ui/EmptyState'
import { CurationCopyButton } from './CurationCopyButton'
import { CurationFieldBlock, type CurationSectionEditProps } from './CurationFieldBlock'

/**
 * Advanced (plan §34): the raw record for transparency and maintenance, plus
 * the structured editor for flexible values. The raw JSON is readable and
 * copyable but is deliberately not the editor — a curator who does not know
 * MongoDB should never need to open it.
 */
export function CurationAdvancedSection({
  record,
  flexible,
  edit,
}: {
  record: Record<string, unknown>
  flexible: FieldNode[]
  edit: CurationSectionEditProps
}): ReactNode {
  const json = JSON.stringify(record, null, 2) ?? ''
  const storedKeys = Object.keys(record).length

  return (
    <AdminSection
      title="Advanced"
      description="Raw access for maintenance. The sections above stay the normal way to change a Curation."
      action={<p className="ui-section-count">{storedKeys} stored keys</p>}
    >
      <div className="ui-raw">
        <div className="ui-raw__header">
          <h3 className="ui-raw__title">View raw record</h3>
          <CurationCopyButton text={json} label="Copy JSON" />
        </div>
        <pre className="ui-raw__json ui-detail-pre">{json}</pre>
      </div>
      <div className="ui-structured">
        <h3 className="ui-structured__title">Edit structured data</h3>
        {flexible.length === 0
          ? (
              <EmptyState
                title="No structured values to edit"
                description="This record stores no flexible values outside the sections above."
              />
            )
          : flexible.map((node) => <CurationFieldBlock key={node.path} node={node} edit={edit} />)}
      </div>
    </AdminSection>
  )
}
