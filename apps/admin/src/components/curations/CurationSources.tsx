'use client'

import { useState } from 'react'

/**
 * Sources are grouped by source type and each entry is rendered from its own
 * keys — the shape is open (`google_places`, `audio`, `image`, imports, future
 * collectors), so a fixed set of columns would hide exactly the fields an
 * operator needs. Known media keys get a real viewer; everything else stays as
 * labelled scalars.
 */
const MEDIA_KEYS = ['url', 'image_url', 'thumbnail', 'src', 'original_url'] as const

function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() ? value : null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function mediaUrl(entry: Record<string, unknown>): string | null {
  for (const key of MEDIA_KEYS) {
    const value = scalar(entry[key])
    if (value && /^https?:\/\//i.test(value)) return value
  }
  return null
}

function entriesFor(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (item !== null && typeof item === 'object' ? [item as Record<string, unknown>] : []))
  }
  if (value !== null && typeof value === 'object') return [value as Record<string, unknown>]
  return []
}

function labelFor(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export function CurationSources({ sources }: { sources: unknown }) {
  if (sources === null || sources === undefined || typeof sources !== 'object' || Array.isArray(sources)) {
    return <p className="content-record__hint">No sources recorded.</p>
  }

  const groups = Object.entries(sources as Record<string, unknown>)
    .map(([type, value]) => [type, entriesFor(value)] as const)
    .filter(([, entries]) => entries.length > 0)

  if (groups.length === 0) return <p className="content-record__hint">No sources recorded.</p>

  return (
    <div className="content-sources">
      {groups.map(([type, entries]) => (
        <details className="content-sources__group" key={type} open>
          <summary>
            {labelFor(type)} <span className="content-sources__count">{entries.length}</span>
          </summary>
          <ul className="content-sources__entries">
            {entries.map((entry, index) => (
              <li className="content-sources__entry" key={`${type}-${index}`}>
                <SourceEntry entry={entry} type={type} />
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  )
}

function SourceEntry({ entry, type }: { entry: Record<string, unknown>; type: string }) {
  const url = mediaUrl(entry)
  const audio = Boolean(url) && /audio|voice|recording/i.test(type)
  const image = Boolean(url) && !audio
  const rows = Object.entries(entry).filter(([, value]) => scalar(value) !== null)

  return (
    <article className="content-source">
      {image && (
        <a href={url as string} rel="noreferrer" target="_blank">
          {/* Plain <img>: these are remote originals with unknown dimensions, and Next
              image optimisation would need a per-source remotePatterns allowlist. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={scalar(entry.filename) ?? scalar(entry.alt) ?? type} className="content-source__thumb" src={url as string} />
        </a>
      )}
      {audio && <audio className="content-source__audio" controls preload="none" src={url as string} />}
      <dl className="content-source__fields">
        {rows.map(([key, value]) => (
          <div key={key}>
            <dt>{labelFor(key)}</dt>
            <dd>{truncate(String(value))}</dd>
          </div>
        ))}
      </dl>
      {rows.length === 0 && <p className="content-record__hint">No scalar fields.</p>}
    </article>
  )
}

/** Long values (analysis text, raw payloads) stay readable but must not dominate the list. */
function truncate(value: string, max = 400): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * Collapsible raw view of one source group, so an operator can always fall back
 * to the stored shape without leaving the record.
 */
export function RawSourceJson({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="content-source__raw">
      <button onClick={() => setOpen((current) => !current)} type="button">
        {open ? 'Hide raw JSON' : 'View raw JSON'}
      </button>
      {open && <pre>{JSON.stringify(value, null, 2)}</pre>}
    </div>
  )
}
