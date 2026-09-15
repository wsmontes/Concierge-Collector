'use client'

import { useId, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { FieldNode } from '../../content/field-types'
import { AdminSection } from '../ui/AdminPage'
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
  const newCategoryId = useId()
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
    <div className="curation-concepts__editor" onKeyDown={handleKeyDown}>
      <ul className="curation-concepts__draft">
        {draft.map((group, groupIndex) => (
          <li key={`${groupIndex}-${group.category}`} className="curation-concepts__draft-group">
            <div className="curation-concepts__draft-header">
              <h4>{group.category}</h4>
              <button type="button" onClick={() => removeCategory(groupIndex)}>Remove category</button>
            </div>
            <ul className="curation-concepts__draft-values">
              {group.values.map((value, valueIndex) => (
                <li key={valueIndex}>
                  <input
                    aria-label={`${group.category} value ${valueIndex + 1}`}
                    type="text"
                    value={value}
                    onChange={(event) => setValue(groupIndex, valueIndex, event.target.value)}
                  />
                  <button type="button" onClick={() => removeValue(groupIndex, valueIndex)}>Remove value</button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => addValue(groupIndex)}>Add value</button>
          </li>
        ))}
      </ul>
      <div className="curation-concepts__new">
        <label htmlFor={newCategoryId}>New category</label>
        <input
          id={newCategoryId}
          type="text"
          value={newCategory}
          onChange={(event) => setNewCategory(event.target.value)}
        />
        <button type="button" onClick={addCategory}>Add category</button>
      </div>
      <div className="curation-concepts__actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={save}>Save</button>
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
        ? <button type="button" onClick={() => edit.onEdit(node.path)}>Edit Concepts</button>
        : undefined}
    >
      {groups.length === 0
        ? <p className="curation-concepts__empty">No concepts recorded.</p>
        : (
            <div className="curation-concepts">
              {groups.map((group) => (
                <div className="curation-concept" key={group.category}>
                  <h3 className="curation-concept__category">{group.category}</h3>
                  <ul className="curation-concept__values">
                    {group.values.map((value, position) => (
                      <li className="curation-concept__value" key={position}>
                        <span className="curation-concept__chip">{value}</span>
                        <CurationLink
                          className="curation-concept__link"
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
