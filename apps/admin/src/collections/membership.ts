export interface MembershipInterval {
  addedInVersion: number
  removedInVersion: number | null
}

/** Returns whether an interval belongs to the immutable Collection version. */
export function isMemberAtVersion(interval: MembershipInterval, version: number): boolean {
  return interval.addedInVersion <= version
    && (interval.removedInVersion === null || interval.removedInVersion > version)
}
