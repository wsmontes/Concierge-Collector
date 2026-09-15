/**
 * Field tree of an arbitrary stored record.
 *
 * The record is the source of truth: the walk emits one node per own
 * enumerable key — and per array slot — so a field nobody described still
 * shows up, which is the plan's "nothing disappears" promise. The registry
 * only annotates nodes whose path it knows.
 */

import { fieldPathLabel, formatFieldPath, matchesFieldQuery, type PathSegment } from './field-path'
import {
  inferFieldType,
  isFieldEditable,
  type ContentRecordKind,
  type FieldDescriptor,
  type FieldNode,
} from './field-types'
import { isRecord } from './value-guards'

const TEMPLATE_PATH = /\[\]/

/**
 * A descriptor paired with the question the walk keeps asking about it:
 * literal paths are matched exactly, `[]` paths pattern-match every index.
 */
interface DescriptorPattern {
  descriptor: FieldDescriptor
  templated: boolean
}

function toPatterns(descriptors: readonly FieldDescriptor[]): DescriptorPattern[] {
  const patterns: DescriptorPattern[] = []
  for (const descriptor of descriptors) {
    patterns.push({ descriptor, templated: TEMPLATE_PATH.test(descriptor.path) })
  }
  return patterns
}

/** Canonical notation with every array index collapsed to `[]`. */
function templateOf(segments: readonly PathSegment[]): string {
  let path = ''
  for (const segment of segments) {
    if (segment.kind === 'index') {
      path += '[]'
      continue
    }
    path += path.length === 0 ? segment.key : `.${segment.key}`
  }
  return path
}

/** Exact path first, then the `[]` template that covers this index — else null. */
function descriptorFor(patterns: readonly DescriptorPattern[], path: string, template: string): FieldDescriptor | null {
  let templated: FieldDescriptor | null = null
  for (const pattern of patterns) {
    if (pattern.templated) {
      if (templated === null && pattern.descriptor.path === template) templated = pattern.descriptor
      continue
    }
    if (pattern.descriptor.path === path) return pattern.descriptor
  }
  return templated
}

function buildNode(
  value: unknown,
  segments: readonly PathSegment[],
  depth: number,
  kind: ContentRecordKind,
  patterns: readonly DescriptorPattern[],
): FieldNode {
  const path = formatFieldPath(segments)
  const descriptor = descriptorFor(patterns, path, templateOf(segments))
  const system = descriptor?.system === true
  const type = descriptor?.type ?? inferFieldType(value)
  return {
    path,
    label: descriptor?.label ?? fieldPathLabel(path),
    type,
    value,
    depth,
    descriptor,
    owner: descriptor?.owner ?? kind,
    // The plan's promise: a field the UI was never written for is still
    // editable through the structured editor. `system` always wins as
    // read-only, and a known field opts out with an explicit `editable: false`.
    editable: !system && descriptor?.editable !== false && isFieldEditable(type),
    system,
    children: childrenOf(value, segments, depth + 1, kind, patterns),
  }
}

function childrenOf(
  value: unknown,
  segments: readonly PathSegment[],
  depth: number,
  kind: ContentRecordKind,
  patterns: readonly DescriptorPattern[],
): FieldNode[] {
  const nodes: FieldNode[] = []
  if (Array.isArray(value)) {
    for (let position = 0; position < value.length; position += 1) {
      nodes.push(buildNode(value[position], [...segments, { kind: 'index', index: position }], depth, kind, patterns))
    }
    return nodes
  }
  if (!isRecord(value)) return nodes
  for (const key of Object.keys(value)) {
    nodes.push(buildNode(value[key], [...segments, { kind: 'key', key }], depth, kind, patterns))
  }
  return nodes
}

/** One node per stored field, in stored order, annotated where the registry knows the path. */
export function buildFieldTree(
  record: unknown,
  descriptors: readonly FieldDescriptor[],
  kind: ContentRecordKind,
): FieldNode[] {
  return childrenOf(record, [], 0, kind, toPatterns(descriptors))
}

function appendFlat(nodes: readonly FieldNode[], flat: FieldNode[]): void {
  for (const node of nodes) {
    flat.push(node)
    appendFlat(node.children, flat)
  }
}

/** Pre-order walk over a tree, container nodes included. */
export function flattenFieldTree(nodes: readonly FieldNode[]): FieldNode[] {
  const flat: FieldNode[] = []
  appendFlat(nodes, flat)
  return flat
}

function cloneNodes(nodes: readonly FieldNode[]): FieldNode[] {
  const clones: FieldNode[] = []
  for (const node of nodes) clones.push({ ...node, children: cloneNodes(node.children) })
  return clones
}

function pruneNodes(nodes: readonly FieldNode[], query: string): FieldNode[] {
  const kept: FieldNode[] = []
  for (const node of nodes) {
    if (matchesFieldQuery(node.path, node.value, query)) {
      kept.push({ ...node, children: cloneNodes(node.children) })
      continue
    }
    const children = pruneNodes(node.children, query)
    if (children.length > 0) kept.push({ ...node, children })
  }
  return kept
}

/**
 * Prunes a tree to a record-local query. A match keeps its whole subtree (the
 * children are the matched container's context); a deeper match keeps its
 * ancestors with only the matching branch.
 */
export function filterFieldTree(nodes: readonly FieldNode[], query: string): FieldNode[] {
  // A blank query is the identity — callers compare the result, so hand back
  // the very same array instead of an equal copy.
  if (query.trim().length === 0) return nodes as FieldNode[]
  return pruneNodes(nodes, query)
}

/**
 * Registry entries the record does not store — the fields a record page has to
 * render as empty. `[]` templates are not addressable, so they never count.
 */
export function declaredButAbsent(
  descriptors: readonly FieldDescriptor[],
  nodes: readonly FieldNode[],
): FieldDescriptor[] {
  const present: Record<string, true | undefined> = {}
  for (const node of flattenFieldTree(nodes)) present[node.path] = true
  const absent: FieldDescriptor[] = []
  const seen: Record<string, true | undefined> = {}
  for (const descriptor of descriptors) {
    if (TEMPLATE_PATH.test(descriptor.path)) continue
    if (present[descriptor.path] === true) continue
    if (seen[descriptor.path] === true) continue
    seen[descriptor.path] = true
    absent.push(descriptor)
  }
  return absent
}
