import type { NormalizedCurationFilters } from '../explorer/types'

export type SelectionMode = 'explicit' | 'all_matching'
export type SelectionStatus = 'queued' | 'materializing' | 'ready' | 'failed' | 'expired'

export interface SelectionLease {
  fencingToken: number
  owner: string
}

export interface CreateSelectionCommand {
  actorId: string
  curationIds?: string[]
  excludedIds?: string[]
  filters?: NormalizedCurationFilters
  idempotencyKey: string
  mode: SelectionMode
  requestId: string
}

export interface SelectionManifestRecord {
  actorId: string
  candidateCount: number
  capturedCount: number
  checkpointCursor: string | null
  excludedIds: string[]
  expiresAt: Date
  retainedUntil?: Date | null
  fencingToken: number
  filters: NormalizedCurationFilters | null
  id: string
  manifestHash: string | null
  mode: SelectionMode
  payloadJobId: string | null
  requestHash: string
  scanComplete: boolean
  scanToken: string | null
  skippedCount: number
  skippedReasons: Record<string, number>
  status: SelectionStatus
}

export interface SelectionCatalogClient {
  introspectAdmin(actorId: string): Promise<void>
  resolveCurations(ids: string[], actorId: string): Promise<{ eligibleIds: string[]; rejected: Array<{ curationId: string; reason: string }> }>
  /**
   * Freezes the scan of one intent. `excludeCurationIds` is the boundary's
   * `exclude_curation_ids`: the live membership exclusion the "Without
   * Collections" view needs, so an all-matching intent materializes exactly the
   * set the filtered listing showed.
   */
  startScan(
    filters: NormalizedCurationFilters,
    actorId: string,
    excludeCurationIds?: readonly string[],
  ): Promise<{ maxCatalogSequence: number; scanToken: string }>
  scanPage(input: { actorId: string; cursor: string | null; limit: number; scanToken: string }): Promise<{ items: Array<{ curation_id: string }>; next_cursor: string | null }>
}
