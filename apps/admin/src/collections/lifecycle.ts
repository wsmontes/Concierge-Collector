import type { CollectionLifecycle, CollectionMetadataInput, LifecycleCommand } from './types'

export type LifecycleDecision = 'hard-delete' | 'archived' | 'published' | 'patch' | 'reject'

export interface LifecycleState {
  lifecycle: CollectionLifecycle
  everPublished: boolean
  slug?: string
}

export class LifecycleDecisionError extends Error {}

export function normalizeCollectionTitle(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new LifecycleDecisionError('title_invalid')
  return normalized
}

/**
 * Determines the legal lifecycle change without touching persistence. A published
 * Collection can keep accumulating a draft, but its external slug is permanent.
 */
export function decideLifecycle(
  state: LifecycleState,
  command: LifecycleCommand,
  metadata: CollectionMetadataInput = {},
): LifecycleDecision {
  if (command === 'patch') {
    if (state.everPublished && metadata.slug !== undefined && metadata.slug !== state.slug) {
      throw new LifecycleDecisionError('slug_immutable')
    }
    return state.lifecycle === 'archived' ? 'reject' : 'patch'
  }

  if (command === 'delete') {
    return !state.everPublished && state.lifecycle === 'draft' ? 'hard-delete' : 'reject'
  }

  if (command === 'archive') {
    return state.lifecycle === 'published' && state.everPublished ? 'archived' : 'reject'
  }

  return state.lifecycle === 'archived' && state.everPublished ? 'published' : 'reject'
}

/** Converts an editor-provided label to the only slug format accepted by v1. */
export function normalizeCollectionSlug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) || normalized.length < 3 || normalized.length > 80) {
    throw new LifecycleDecisionError('slug_invalid')
  }

  return normalized
}
