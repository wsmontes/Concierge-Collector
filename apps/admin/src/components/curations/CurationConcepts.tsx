'use client'

import Link from 'next/link'
import { writeCurationListQuery } from '../../curations/list-query'

/**
 * Concept categories are data, not code: the Mongo concepts collection defines
 * them and the pipeline can add one at any time, so this renders whatever the
 * record holds instead of a fixed list of category names.
 */
export function CurationConcepts({ categories }: { categories: unknown }) {
  if (!categories || typeof categories !== 'object' || Array.isArray(categories)) {
    return <p className="content-record__hint">No concepts recorded.</p>
  }

  const entries = Object.entries(categories as Record<string, unknown>)
    .map(([name, values]) => [name, conceptValues(values)] as const)
    .filter(([, values]) => values.length > 0)

  if (entries.length === 0) return <p className="content-record__hint">No concepts recorded.</p>

  return (
    <dl className="content-concepts">
      {entries.map(([name, values]) => (
        <div className="content-concepts__group" key={name}>
          <dt>{name}</dt>
          <dd>
            <ul className="content-concepts__values">
              {values.map((value) => (
                <li key={value}>
                  <Link href={`/admin/curations?${writeCurationListQuery({ q: value })}`}>{value}</Link>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** A category holds a list of strings in the current model, but legacy rows may nest or hold scalars. */
function conceptValues(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap((item) => conceptValues(item))
  if (value && typeof value === 'object') return Object.values(value).flatMap((item) => conceptValues(item))
  return []
}
