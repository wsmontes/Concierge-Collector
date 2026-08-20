export type DraftDeltaAction = 'add' | 'remove'
export type DraftDelta = DraftDeltaAction | null

/**
 * Collapses repeated draft actions to the one effective difference from the
 * published membership. This makes re-entry a new interval at publish time,
 * without preserving transient edits in the draft delta.
 */
export function convergeDraftDelta(
  published: boolean,
  _current: DraftDelta,
  action: DraftDeltaAction,
): DraftDelta {
  const desiredMembership = action === 'add'

  if (desiredMembership === published) return null
  return desiredMembership ? 'add' : 'remove'
}

/**
 * A null desired delta is not automatically a no-op: it can be the explicit
 * undo of a previously committed draft delta. The worker must compare the
 * converged delta with the currently visible delta before deciding whether an
 * operation item is applied or skipped.
 */
export function draftDeltaTransition(
  published: boolean,
  current: DraftDelta,
  action: DraftDeltaAction,
): { desired: DraftDelta; changed: boolean } {
  const desired = convergeDraftDelta(published, current, action)
  return { desired, changed: desired !== current }
}
