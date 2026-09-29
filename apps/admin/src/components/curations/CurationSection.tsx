'use client'

import type { ReactNode } from 'react'

/**
 * One named block of a record screen. Sections keep the record page readable as
 * a document instead of turning it into one long form.
 */
export function CurationSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`curation-${id}-title`} className="content-record__section">
      <h2 id={`curation-${id}-title`}>{title}</h2>
      <div className="content-record__section-body">{children}</div>
    </section>
  )
}
