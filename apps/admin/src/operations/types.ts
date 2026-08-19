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
  baseDraftRevision: number
  curationIds: string[]
  idempotencyKey: string
  actorId: string
  requestId: string
}

export interface DraftOperationRecord {
  id: string
  collectionId: string
  action: DraftOperationAction
  mode: 'explicit'
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
  errorCode?: string | null
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
