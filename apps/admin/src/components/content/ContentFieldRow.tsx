'use client'

import { useState } from 'react'
import type { FieldOwner } from '../../content/field-registry'
import type { FieldNode } from '../../content/record-inspector'
import { formatFieldValue } from './format-field-value'

/** Text longer than this is clamped by CSS until the row is expanded. */
const LONG_VALUE = 200

const OWNER_LABELS: Record<FieldOwner, string> = {
  collection: 'Collection',
  curation: 'Curation',
  entity: 'Entity',
  system: 'System',
}

export interface ContentFieldRowProps {
  node: FieldNode
  /**
   * A filtered tree is a view of the matches themselves: containers render open
   * and drop their disclosure, so no control can promise a collapse that the
   * inspector would immediately undo on the next keystroke.
   */
  revealMatches?: boolean
}

interface FieldBadge {
  label: string
  tone: 'derived' | 'readonly' | 'system'
}

function rowBadges(node: FieldNode): FieldBadge[] {
  const badges: FieldBadge[] = []
  if (!node.editable) badges.push({ label: 'Read-only', tone: 'readonly' })
  if (node.derivedIn) badges.push({ label: `Derived from ${OWNER_LABELS[node.derivedIn]}`, tone: 'derived' })
  if (node.system) badges.push({ label: 'System-managed', tone: 'system' })
  return badges
}

/**
 * One inspector row: path, label, value and the disclosure that owns the
 * subtree. Containers start collapsed so a raw Mongo document stays scannable;
 * long text stays in the DOM in full and is released by CSS, never by slicing.
 */
export function ContentFieldRow({ node, revealMatches = false }: ContentFieldRowProps) {
  const container = node.children.length > 0
  const formatted = formatFieldValue(node.value, node.type)
  const longValue = !container && (formatted.includes('\n') || formatted.length > LONG_VALUE)
  const collapsible = container || longValue
  const [open, setOpen] = useState(!collapsible)
  const expanded = revealMatches || open
  const badges = rowBadges(node)

  return (
    <li className="content-field" data-expanded={expanded ? 'true' : 'false'}>
      <div className="content-field__header">
        {collapsible && !revealMatches ? (
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.label}`}
            className="content-field__disclosure"
            onClick={() => setOpen((previous) => !previous)}
            type="button"
          >
            {expanded ? '−' : '+'}
          </button>
        ) : <span aria-hidden="true" className="content-field__disclosure" data-static="true" />}
        <code className="content-field__path">{node.path}</code>
        <span className="content-field__label">{node.label}</span>
        {badges.map((badge, index) => (
          <span className="content-field__badge" data-tone={badge.tone} key={`${badge.tone}-${index}`}>
            {badge.label}
          </span>
        ))}
        <span className="content-field__value">
          {container ? `${node.children.length} ${node.children.length === 1 ? 'item' : 'items'}` : formatted}
        </span>
      </div>
      {container && expanded && (
        <ul className="content-field__children">
          {node.children.map((child) => (
            <ContentFieldRow key={child.path} node={child} revealMatches={revealMatches} />
          ))}
        </ul>
      )}
    </li>
  )
}
