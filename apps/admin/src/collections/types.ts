export type CollectionLifecycle = 'draft' | 'published' | 'archived'
export type CollectionDraftState = 'clean' | 'dirty' | 'publishing' | 'failed'

export interface CollectionRecord {
  id: string
  slug: string
  title: string
  description?: string | null
  lifecycle: CollectionLifecycle
  currentPublishedVersion?: number | null
  draftBaseVersion?: number | null
  draftEpoch: string
  draftRevision: number
  draftState: CollectionDraftState
  publishedSelectedCount: number
  draftSelectedCount: number
  revision: number
  everPublished: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CollectionMetadataInput {
  slug?: string
  title?: string
  description?: string | null
}

export interface AuditContext {
  actorId: string
  idempotencyKey: string
  requestId: string
}

export type LifecycleCommand = 'patch' | 'delete' | 'archive' | 'restore'

