/**
 * Timestamp rendering for the editorial admin surfaces.
 *
 * Behavioural reference: `scripts/ui-core/uiUtils.js#formatRelativeDate` — the
 * Collector's canonical formatter. Relative below ~30 days through a cached
 * `Intl.RelativeTimeFormat`, absolute beyond it. The absolute rendering is
 * exported separately so a cell can expose it as a `title`.
 */

const RELATIVE_LIMIT_SECONDS = 60 * 60 * 24 * 30
const SECOND = 1
const MINUTE = 60
const HOUR = 3600
const DAY = 86400

let relativeFormatter: Intl.RelativeTimeFormat | null = null

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "2 hours ago", "3 days ago"; the raw value when it is not a date. */
export function formatRelativeDate(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const date = toDate(value)
  if (!date) return value
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000)
  const distance = Math.abs(diffSeconds)
  if (distance >= RELATIVE_LIMIT_SECONDS) return date.toLocaleString()
  const unit: Intl.RelativeTimeFormatUnit =
    distance < MINUTE ? 'second' : distance < HOUR ? 'minute' : distance < DAY ? 'hour' : 'day'
  const divisor = unit === 'second' ? SECOND : unit === 'minute' ? MINUTE : unit === 'hour' ? HOUR : DAY
  relativeFormatter ??= new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  return relativeFormatter.format(Math.round(diffSeconds / divisor), unit)
}

/** Absolute rendering for a `title`; null when the value is not a date. */
export function formatAbsoluteDate(value: string | null | undefined): string | null {
  const date = toDate(value)
  return date ? date.toLocaleString() : null
}
