'use client'

import type { ReactNode } from 'react'

export interface ContentRecordHeaderProps {
  title: string
  subtitle?: string
  badges?: { label: string; tone?: string }[]
  actions?: ReactNode
}

/** Shared header for one record screen: identity, status badges, actions. */
export function ContentRecordHeader({ title, subtitle, badges, actions }: ContentRecordHeaderProps) {
  return (
    <header className="content-record-header">
      <div className="content-record-header__main">
        <h1 className="content-record-header__title">{title}</h1>
        {subtitle && <p className="content-record-header__subtitle">{subtitle}</p>}
        {badges && badges.length > 0 && (
          <ul aria-label="Record status" className="content-record-header__badges">
            {badges.map((badge, index) => (
              <li
                className="content-record-header__badge"
                data-tone={badge.tone}
                key={`${badge.label}-${index}`}
              >
                {badge.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {actions && <div className="content-record-header__actions">{actions}</div>}
    </header>
  )
}
