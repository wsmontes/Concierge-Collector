'use client'

import type { ReactNode } from 'react'
import type { FieldDescriptor, FieldNode } from '../../content/field-types'
import { EntityFieldBlock } from './EntityFieldBlock'

/**
 * The fields of one curated Entity section, in stored order. A registered
 * field the record does not carry is still named here — an editor has to be
 * able to tell "this Entity has no external id" from "this page forgot the
 * external id".
 */
export function EntityFieldSection({
  nodes,
  absent = [],
  editingPath,
  onRequestEdit,
  onCommitValue,
  onCancelEdit,
}: {
  nodes: readonly FieldNode[]
  absent?: readonly FieldDescriptor[]
  editingPath: string | null
  onRequestEdit?: (node: FieldNode) => void
  onCommitValue?: (node: FieldNode, value: unknown) => void
  onCancelEdit?: () => void
}): ReactNode {
  return (
    <ul className="entity-fields">
      {nodes.map((node) => (
        <EntityFieldBlock
          key={node.path}
          node={node}
          editingPath={editingPath}
          onRequestEdit={onRequestEdit}
          onCommitValue={onCommitValue}
          onCancelEdit={onCancelEdit}
        />
      ))}
      {absent.map((descriptor) => (
        <li
          key={descriptor.path}
          className="entity-field entity-field--empty"
          data-path={descriptor.path}
        >
          <div className="entity-field__head">
            <span className="entity-field__label">{descriptor.label}</span>
            <span className="entity-field__path ui-table__mono">{descriptor.path}</span>
            <span className="entity-field__value entity-field__value--empty">Not set</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
