import type { FieldType } from '../../content/field-types'

/** Short preview budget for containers — a JSON blob must never own the row. */
const PREVIEW_LIMIT = 80

const EMPTY = '—'

function jsonPreview(value: unknown): string {
  try {
    // JSON.stringify returns undefined for functions/symbols and throws on
    // circular structures and BigInt; the inspector still has to render a row.
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Human rendering for the inspector read surface.
 *
 * Strings are returned verbatim on purpose: dates are stored as ISO strings and
 * long text is clamped by CSS, so trimming or reformatting here would hide the
 * stored bytes from an operator who is trying to see them.
 */
export function formatFieldValue(value: unknown, type: FieldType): string {
  if (value === null || value === undefined) return EMPTY
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return value

  // A descriptor can disagree with the raw document (unknown fields are typed
  // by inference and drift), so the runtime container check comes first.
  if (typeof value === 'object' || type === 'object' || type === 'array' || type === 'json') {
    const preview = jsonPreview(value)
    return preview.length > PREVIEW_LIMIT ? `${preview.slice(0, PREVIEW_LIMIT - 1)}…` : preview
  }

  return String(value)
}
