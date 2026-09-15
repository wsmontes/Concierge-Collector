'use client'

import type { ReactNode } from 'react'
import type { FieldDescriptor, FieldNode } from '../../content/field-types'
import { ContentFieldEditor } from '../content/ContentFieldEditor'
import { ContentFieldInspector } from '../content/ContentFieldInspector'
import { AdminSection } from '../ui/AdminPage'

/**
 * All fields (plan §10, §19, §35): the Inspector is the guarantor that 100% of
 * the record is reachable — every stored key, registered or not. It only
 * forwards: the workspace owns the search term, the open editor and the save
 * path, so a row edited here is saved exactly like a section block.
 */
export function CurationAllFieldsSection({
  record,
  descriptors,
  search,
  onSearchChange,
  editingPath,
  onRequestEdit,
  onCommitValue,
  onCancelEdit,
}: {
  record: Record<string, unknown>
  descriptors: readonly FieldDescriptor[]
  search: string
  onSearchChange: (value: string) => void
  editingPath: string | null
  onRequestEdit: (node: FieldNode) => void
  onCommitValue: (node: FieldNode, value: unknown) => void
  onCancelEdit: () => void
}): ReactNode {
  return (
    <AdminSection
      title="All fields"
      description="Every field this record stores, plus every registered field it does not. Search by field name or by value."
    >
      <ContentFieldInspector
        record={record}
        kind="curation"
        descriptors={descriptors}
        label="Every stored field"
        search={search}
        onSearchChange={onSearchChange}
        editingPath={editingPath}
        onRequestEdit={onRequestEdit}
        onCommitValue={onCommitValue}
        onCancelEdit={onCancelEdit}
        renderEditor={(node, commit, cancel) => <ContentFieldEditor node={node} onCommit={commit} onCancel={cancel} />}
      />
    </AdminSection>
  )
}
