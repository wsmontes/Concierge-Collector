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
