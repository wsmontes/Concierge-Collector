'use client'

import { Button } from '@payloadcms/ui'
import type { FormEvent } from 'react'
import type { ReactNode } from 'react'
import { descriptorsFor } from '../../content/field-registry'
import { SelectInput } from '../ui/Field'
import { SearchInput, Toolbar, ToolbarGroup } from '../ui/Toolbar'

/** Filter values as typed, before they are applied to the list and the URL. */
export interface EntityFilterDraft {
  q: string
  type: string
  status: string
}

/**
 * The vocabulary of a registry enum field. The filter offers exactly what the
 * field registry declares — never a second, drifting copy of the enum.
 */
function enumOptions(path: string): readonly string[] {
  const descriptor = descriptorsFor('entity').find((entry) => entry.path === path)
  return descriptor?.enumValues ?? []
}

function optionsFor(path: string, allLabel: string): Array<{ label: string; value: string }> {
  return [
    { label: allLabel, value: '' },
    ...enumOptions(path).map((option) => ({ label: option, value: option })),
  ]
}

/**
 * The Entity filters, on the shared toolbar.
 *
 * The search field and the two selects carry their own labels (the search one
 * visually hidden, because the icon and the placeholder already say it), so the
 * bar works with a screen reader and without one. Before this the surface
 * stacked a titled box of filters, a sort box and a saved-view box above the
 * table and pushed the list below the fold.
 */
export function EntitiesFilterForm({
  value,
  onChange,
  onApply,
  onReset,
}: {
  value: EntityFilterDraft
  onChange: (value: EntityFilterDraft) => void
  onApply: () => void
  onReset: () => void
}): ReactNode {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onApply()
  }

  return (
    <form aria-label="Entity filters" className="entities-filter-form" onSubmit={submit}>
      <Toolbar label="Entity filters">
        <ToolbarGroup>
          <SearchInput
            label="Search Entities"
            name="q"
            onChange={(q) => onChange({ ...value, q })}
            placeholder="Search by name, id or city"
            value={value.q}
          />
        </ToolbarGroup>
        <ToolbarGroup>
          <SelectInput
            id="entities-filter-type"
            label="Type"
            onChange={(type) => onChange({ ...value, type })}
            options={optionsFor('type', 'All types')}
            value={value.type}
          />
          <SelectInput
            id="entities-filter-status"
            label="Status"
            onChange={(status) => onChange({ ...value, status })}
            options={optionsFor('status', 'All statuses')}
            value={value.status}
          />
        </ToolbarGroup>
        <ToolbarGroup end>
          <Button margin={false} type="submit">
            Apply filters
          </Button>
          <Button buttonStyle="secondary" margin={false} onClick={onReset} type="button">
            Reset filters
          </Button>
        </ToolbarGroup>
      </Toolbar>
    </form>
  )
}
