import { joinPath } from './field-path'
import { inferFieldType } from './field-types'
import type { FieldType } from './field-types'
import { CURATION_FIELDS, ENTITY_FIELDS, describeField } from './field-registry'
import type { FieldOwner } from './field-registry'

export interface FieldNode {
  path: string
  label: string
  value: unknown
  type: FieldType
  owner: FieldOwner
  editable: boolean
  system: boolean
  derivedIn?: FieldOwner
  children: FieldNode[]
  leafCount: number
}

type ContentKind = 'curation' | 'entity'
type Container = Record<string, unknown> | unknown[]

const INDEX_KEY = /^\d+$/

/**
 * Tree of every field present in the record: registered fields first (registry
 * order), then unknown fields in document order. Nothing is dropped, so a new
 * backend field is visible before anyone registers it.
 */
export function inspectRecord(record: unknown, kind: ContentKind): FieldNode[] {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return []
  return childNodes(record as Container, '', kind)
}

export function flattenFields(nodes: readonly FieldNode[]): FieldNode[] {
  const flat: FieldNode[] = []
  collectFields(nodes, flat)
  return flat
}

function collectFields(nodes: readonly FieldNode[], into: FieldNode[]): void {
  for (const node of nodes) {
    into.push(node)
    collectFields(node.children, into)
  }
}

export function filterFields(nodes: readonly FieldNode[], query: string): FieldNode[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return nodes.slice()
  const filtered: FieldNode[] = []
  for (const node of nodes) {
    const match = selectNode(node, needle)
    if (match) filtered.push(match)
  }
  return filtered
}

function childNodes(container: Container, parent: string, kind: ContentKind): FieldNode[] {
  const registry = kind === 'entity' ? ENTITY_FIELDS : CURATION_FIELDS
  const nodes: FieldNode[] = []
  const covered = new Set<string>()
  for (const field of registry) {
    const separator = field.path.lastIndexOf('.')
    const fieldParent = separator === -1 ? '' : field.path.slice(0, separator)
    if (fieldParent !== parent) continue
    const key = field.path.slice(separator + 1)
    if (!Object.prototype.hasOwnProperty.call(container, key)) continue
    covered.add(key)
    nodes.push(buildNode(field.path, (container as Record<string, unknown>)[key], kind))
  }
  for (const key of Object.keys(container)) {
    if (covered.has(key)) continue
    const arrayElement = Array.isArray(container) && INDEX_KEY.test(key)
    nodes.push(buildNode(joinPath(parent, key), (container as Record<string, unknown>)[key], kind, arrayElement ? `[${key}]` : undefined))
  }
  return nodes
}

function buildNode(path: string, value: unknown, kind: ContentKind, label?: string): FieldNode {
  const descriptor = describeField(kind, path)
  // A scalar array is data, not structure: recursing into its indexes would
  // produce a child per element with no interesting shape.
  const scalarArray = Array.isArray(value) && value.every((item) => item === null || typeof item !== 'object')
  const children =
    scalarArray || typeof value !== 'object' || value === null ? [] : childNodes(value as Container, path, kind)
  const system = descriptor.system ?? false
  const registry = kind === 'entity' ? ENTITY_FIELDS : CURATION_FIELDS
  const type: FieldType = scalarArray
    ? 'array'
    : (registry.find((field) => field.path === path)?.type ?? inferFieldType(value))
  const node: FieldNode = {
    path,
    label: label ?? descriptor.label,
    value,
    type,
    owner: descriptor.owner,
    editable: descriptor.editable ?? !system,
    system,
    children,
    leafCount: children.length === 0 ? 1 : children.reduce((total, child) => total + child.leafCount, 0),
  }
  if (descriptor.derivedIn !== undefined) node.derivedIn = descriptor.derivedIn
  return node
}

function selectNode(node: FieldNode, needle: string): FieldNode | null {
  const matchedSelf = node.path.toLowerCase().includes(needle) || node.label.toLowerCase().includes(needle)
  const children: FieldNode[] = []
  for (const child of node.children) {
    const match = selectNode(child, needle)
    if (match) children.push(match)
  }
  // A node matched on its own path/label is kept whole: the query asked for the
  // field, not for one of its leaves.
  if (matchedSelf) return node
  if (node.children.length === 0) return stringifyLeaf(node.value).toLowerCase().includes(needle) ? node : null
  if (children.length === 0) return null
  // Only ancestors of matches are kept, pruned to the matching branches, so
  // counts describe what is actually displayed.
  return { ...node, children, leafCount: children.reduce((total, child) => total + child.leafCount, 0) }
}

function stringifyLeaf(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(stringifyLeaf).filter((item) => item !== '').join(' ')
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}
