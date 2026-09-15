/**
 * Humanization of one search response into the rows the palette renders.
 *
 * The palette must never lead with an id: every row carries a primary label a
 * person recognizes (a name, a restaurant, a Collection title), the facets that
 * tell two same-named records apart, and the id only ever as demoted detail.
 */

import type { EntityRow } from '../../content/record-types'
import type { AdminCurationRow } from '../../explorer/types'
import type { CollectionHit, SearchResults } from './search-types'

export type SearchRowKind = 'entity' | 'curation' | 'collection'

export interface SearchRow {
  /** DOM key: the same id can appear under two families, the kind cannot. */
  key: string
  kind: SearchRowKind
  /** Position in the palette's flattened reading order — the keyboard's axis. */
  index: number
  /** Primary label. Never a raw id. */
  label: string
  /** Facets under the label; empty when the record carries none. */
  meta: string
  /** The record id, rendered as secondary detail only. */
  id: string
  href: string
}

export interface SearchGroup {
  kind: SearchRowKind
  title: string
  rows: SearchRow[]
}

export const SEARCH_GROUP_TITLES: Record<SearchRowKind, string> = {
  entity: 'ENTITIES',
  curation: 'CURATIONS',
  collection: 'COLLECTIONS',
}

/** Facets the record does not carry drop out instead of rendering as blanks. */
function facet(...parts: (string | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' · ')
}

export function entityHref(id: string): string {
  return `/admin/entities/${encodeURIComponent(id)}`
}

export function curationHref(curationId: string): string {
  return `/admin/curations/${encodeURIComponent(curationId)}`
}

export function collectionHref(id: string): string {
  return `/admin/collections/collections/${encodeURIComponent(id)}`
}

/** The option id both the input's `aria-activedescendant` and the row use. */
export function searchOptionId(index: number): string {
  return `global-search-option-${index}`
}

function entityRow(entity: EntityRow, index: number): SearchRow {
  return {
    key: `entity:${entity.id}`,
    kind: 'entity',
    index,
    label: entity.name,
    meta: facet(entity.type, entity.city),
    id: entity.id,
    href: entityHref(entity.id),
  }
}

function curationRow(curation: AdminCurationRow, index: number): SearchRow {
  return {
    key: `curation:${curation.curation_id}`,
    kind: 'curation',
    index,
    label: curation.restaurant_name ?? 'Untitled curation',
    meta: facet(curation.entity_type, curation.status, curation.city),
    id: curation.curation_id,
    href: curationHref(curation.curation_id),
  }
}

function collectionRow(collection: CollectionHit, index: number): SearchRow {
  return {
    key: `collection:${collection.id}`,
    kind: 'collection',
    index,
    label: collection.title.length > 0 ? collection.title : collection.slug,
    meta: facet(collection.slug, `${collection.draftSelectedCount} in draft`),
    id: collection.id,
    href: collectionHref(collection.id),
  }
}

/**
 * Groups in reading order, numbered as one list: a family with no hit is
 * omitted, never rendered empty, and the indices stay contiguous across the
 * groups that remain — that is what the keyboard walks.
 */
export function buildSearchGroups(results: SearchResults): SearchGroup[] {
  const curationOffset = results.entities.length
  const collectionOffset = curationOffset + results.curations.length

  const groups: SearchGroup[] = [
    {
      kind: 'entity',
      title: SEARCH_GROUP_TITLES.entity,
      rows: results.entities.map((entity, index) => entityRow(entity, index)),
    },
    {
      kind: 'curation',
      title: SEARCH_GROUP_TITLES.curation,
      rows: results.curations.map((curation, index) => curationRow(curation, curationOffset + index)),
    },
    {
      kind: 'collection',
      title: SEARCH_GROUP_TITLES.collection,
      rows: results.collections.map((collection, index) => collectionRow(collection, collectionOffset + index)),
    },
  ]
  return groups.filter((group) => group.rows.length > 0)
}

/** The keyboard order: the rows exactly as they render, group after group. */
export function flattenSearchGroups(groups: readonly SearchGroup[]): SearchRow[] {
  return groups.flatMap((group) => group.rows)
}
