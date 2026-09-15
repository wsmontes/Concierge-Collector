/**
 * Canonical runtime guards shared by the editorial content layer.
 *
 * Admin data arrives as decoded JSON, so the field walkers need one agreed
 * narrowing helper instead of every module inventing its own.
 */

/** Narrows an unknown value to a plain keyed container; fields stay `unknown`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
