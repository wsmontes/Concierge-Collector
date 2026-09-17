'use client'

import { Button } from '@payloadcms/ui'
import { useId, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { FieldNode } from '../../content/field-types'
import { AdminSection } from '../ui/AdminPage'
import { Chip } from '../ui/Chip'
import { EmptyState } from '../ui/EmptyState'
import { TextInput } from '../ui/Field'
import { CurationLink, type CurationNavigate } from './CurationLink'
import type { CurationSectionEditProps } from './CurationFieldBlock'
import type { ConceptGroup } from './curation-record-values'

/** The edit draft keeps the stored order so Save never reshuffles the record. */
interface ConceptDraft {
  category: string
  values: string[]
}

/**
 * Concepts (plan §16): add a value, remove a value, add a whole category. The
 * draft is `{ [category]: string[] }` — the exact shape `categories` stores —
 * so Save hands the workspace the new value of one top-level key.
 */
function ConceptEditor({
  groups,
  onCommit,
  onCancel,
}: {
  groups: ConceptGroup[]
  onCommit: (value: unknown) => void
  onCancel: () => void
}): ReactNode {
  const fieldId = useId()
  const [draft, setDraft] = useState<ConceptDraft[]>(
    () => groups.map((group) => ({ category: group.category, values: [...group.values] })),
  )
  const [newCategory, setNewCategory] = useState('')

  function setValue(groupIndex: number, valueIndex: number, value: string) {
    setDraft((current) => current.map((group, index) => index !== groupIndex
      ? group
      : { ...group, values: group.values.map((existing, position) => (position === valueIndex ? value : existing)) }))
  }

  function removeValue(groupIndex: number, valueIndex: number) {
    setDraft((current) => current.map((group, index) => index !== groupIndex
      ? group
      : { ...group, values: group.values.filter((_, position) => position !== valueIndex) }))
  }

  function addValue(groupIndex: number) {
    setDraft((current) => current.map((group, index) => index !== groupIndex
      ? group
      : { ...group, values: [...group.values, ''] }))
  }

  function removeCategory(groupIndex: number) {
    setDraft((current) => current.filter((_, index) => index !== groupIndex))
  }

  function addCategory() {
    const category = newCategory.trim()
    if (category.length === 0) return
    setDraft((current) => current.some((group) => group.category === category)
      ? current
      : [...current, { category, values: [] }])
    setNewCategory('')
  }

  /** Blank rows and blank categories are dropped: nothing empty reaches the PATCH. */
  function save() {
    const next: Record<string, unknown> = {}
    for (const group of draft) {
      const category = group.category.trim()
      if (category.length === 0) continue
      const values: string[] = []
      for (const value of group.values) {
        const trimmed = value.trim()
        if (trimmed.length > 0) values.push(trimmed)
      }
      next[category] = values
    }
    onCommit(next)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onCancel()
  }

  return (
    <div className="ui-concepts__editor" onKeyDown={handleKeyDown}>
      <ul className="ui-concepts__draft">
        {draft.map((group, groupIndex) => (
          <li key={`${groupIndex}-${group.category}`} className="ui-concepts__draft-group">
            <div className="ui-concepts__draft-header">
              <h4>{group.category}</h4>
              <Button buttonStyle="secondary" margin={false} onClick={() => removeCategory(groupIndex)} size="small" type="button">
                Remove category
              </Button>
            </div>
            <ul className="ui-concepts__draft-values">
              {group.values.map((value, valueIndex) => (
                <li key={valueIndex}>
                  <TextInput
                    id={`${fieldId}-${groupIndex}-${valueIndex}`}
                    label={`${group.category} value ${valueIndex + 1}`}
                    onChange={(next) => setValue(groupIndex, valueIndex, next)}
                    value={value}
                  />
                  <Button buttonStyle="secondary" margin={false} onClick={() => removeValue(groupIndex, valueIndex)} size="small" type="button">
                    Remove value
                  </Button>
                </li>
              ))}
            </ul>
            <Button buttonStyle="secondary" margin={false} onClick={() => addValue(groupIndex)} size="small" type="button">
              Add value
            </Button>
          </li>
        ))}
      </ul>
      <div className="ui-concepts__new">
        <TextInput
          id={`${fieldId}-new-category`}
          label="New category"
          onChange={setNewCategory}
          value={newCategory}
        />
        <Button buttonStyle="secondary" margin={false} onClick={addCategory} size="small" type="button">
          Add category
        </Button>
      </div>
      <div className="ui-concepts__actions">
        <Button buttonStyle="secondary" margin={false} onClick={onCancel} type="button">Cancel</Button>
        <Button buttonStyle="primary" margin={false} onClick={save} type="button">Save</Button>
      </div>
    </div>
  )
}

/**
 * Categories are stored data, never a constant: the page lists exactly the
 * groups the record carries. Each value deep-links to the Curations list with
 * the same `concept.<Category>=<value>` key the list reads back.
 */
export function CurationConceptsSection({
  node,
  groups,
  edit,
  navigate,
}: {
  node: FieldNode
  groups: ConceptGroup[]
  edit: CurationSectionEditProps
  navigate?: CurationNavigate
}): ReactNode {
  const editing = edit.editingPath === node.path

  return (
    <AdminSection
      title="Concepts"
      description="Concepts grouped by category. The categories come from the database, so none of them are hardcoded here."
      action={node.editable && !editing
        ? (
            <Button buttonStyle="secondary" margin={false} onClick={() => edit.onEdit(node.path)} size="small" type="button">
              Edit Concepts
            </Button>
          )
        : undefined}
    >
      {groups.length === 0
        ? (
            <EmptyState
              title="No concepts recorded"
              description="This Curation carries no category/value pairs yet. Edit Concepts adds the first one."
            />
          )
        : (
            <div className="ui-concepts">
              {groups.map((group) => (
                <div className="ui-concept" key={group.category}>
                  <h3 className="ui-concept__category">{group.category}</h3>
                  <ul className="ui-concept__values">
                    {group.values.map((value, position) => (
                      <li className="ui-concept__value" key={position}>
                        <Chip size="sm">{value}</Chip>
                        <CurationLink
                          className="ui-concept__link"
                          href={`/admin/curations?concept.${encodeURIComponent(group.category)}=${encodeURIComponent(value)}`}
                          navigate={navigate}
                        >
                          View curations with {group.category} = {value}
                        </CurationLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
      {editing && (
        <ConceptEditor
          groups={groups}
          onCommit={(value) => edit.onCommit(node, value)}
          onCancel={edit.onCancel}
        />
      )}
    </AdminSection>
  )
}
