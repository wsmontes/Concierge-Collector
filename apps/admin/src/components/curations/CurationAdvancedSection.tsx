'use client'

import type { ReactNode } from 'react'
import type { FieldNode } from '../../content/field-types'
import { AdminSection } from '../ui/AdminPage'
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

  return (
    <AdminSection title="Advanced" description="Raw access for maintenance. The sections above stay the normal way to change a Curation.">
      <div className="curation-raw">
        <div className="curation-raw__header">
          <h3 className="curation-raw__title">View raw record</h3>
          <CurationCopyButton text={json} label="Copy JSON" />
        </div>
        <pre className="curation-raw__json">{json}</pre>
      </div>
      <div className="curation-structured">
        <h3 className="curation-structured__title">Edit structured data</h3>
        {flexible.length === 0
          ? <p className="curation-structured__empty">This record stores no flexible values outside the sections above.</p>
          : flexible.map((node) => <CurationFieldBlock key={node.path} node={node} edit={edit} />)}
      </div>
    </AdminSection>
  )
}
