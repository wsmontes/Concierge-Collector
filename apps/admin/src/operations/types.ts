export type DraftOperationAction = 'add' | 'remove'
export type DraftOperationStatus =
  | 'queued'
  | 'materializing'
  | 'staging'
  | 'validating'
  | 'committing'
  | 'committed'
  | 'completed'
  | 'completed_with_skips'
  | 'failed'
  | 'cancelled'
  | 'stale'
  | 'conflicted'
  | 'authorization_revoked'

export interface CreateDraftOperationCommand {
  collectionId: string
  action: DraftOperationAction
  mode?: 'explicit' | 'selection'
  baseDraftRevision: number
  /** Required for explicit commands; selection children never snapshot IDs. */
  curationIds?: string[]
  selectionId?: string | null
  parentOperationId?: string | null
  /** Precomputed request hash; required for selection children whose IDs come from a manifest. */
  requestHash?: string
  /** Manifest capturedCount for selection children (the terminal processed+skipped+failed total). */
  selectedCount?: number
  idempotencyKey: string
  actorId: string
  requestId: string
}

export interface DraftOperationRecord {
  id: string
  collectionId: string
  action: DraftOperationAction
  mode: 'explicit' | 'selection'
  operationSequence: number
  baseDraftRevision: number
  targetDraftRevision: number
  idempotencyKey: string
  requestHash: string
  selectedCount: number
  status: DraftOperationStatus
  progress: Record<string, number>
  checkpoint?: string | null
  leaseOwner?: string | null
  leaseExpiresAt?: Date | null
  fencingToken: number
  actorId: string
  requestId: string
  jobId: string
  parentOperationId?: string | null
  selectionId?: string | null
  selectionHash?: string | null
  errorCode?: string | null
}

/**
 * One bulk intent: one parent operation plus one child per Collection. The
 * parent's status is derived from its children and its totals are never
 * persisted — every read recomputes them by aggregation.
 */
export interface EnqueueMultiTargetInput {
  selectionId: string
  collectionIds: string[]
  action: DraftOperationAction
  idempotencyKey: string
  actorId: string
  requestId: string
}

export type ParentOperationStatus = 'active' | 'completed' | 'failed'

export interface ParentOperationRecord {
  id: string
  actorId: string
  action: DraftOperationAction
  idempotencyKey: string
  requestHash: string
  mode: 'selection'
  selectionId: string
  selectionHash: string
  status: ParentOperationStatus
  requestId: string
  createdAt: Date
  updatedAt: Date
}

/** Aggregated child outcomes of a parent operation, always derived at read time. */
export interface ParentSummary {
  active: number
  completed: number
  failed: number
}

export interface ResolvedCurations {
  eligibleIds: string[]
  rejected: Array<{ curationId: string; reason: 'not_found' | 'ineligible_status' }>
}

export interface CatalogResolver {
  resolveCurations(ids: string[], actorId: string): Promise<ResolvedCurations>
  introspectAdmin(actorId: string): Promise<void>
}

export interface OperationLease {
  owner: string
  fencingToken: number
}
