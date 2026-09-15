'use client'

import { Banner } from '@payloadcms/ui'
import type { ReactNode } from 'react'

export type InlineNoticeTone = 'info' | 'success' | 'warning' | 'error'

export function InlineNotice({
  tone = 'info',
  children,
  action,
}: {
  tone?: InlineNoticeTone
  children: ReactNode
  action?: ReactNode
}) {
  // Payload's Banner has no warning tone; the wrapper class carries the accent.
  const bannerType = tone === 'warning' ? 'default' : tone

  return (
    <div className={`admin-notice admin-notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="admin-notice__content">
        <Banner type={bannerType}>{children}</Banner>
      </div>
      {action && <div className="admin-notice__action">{action}</div>}
    </div>
  )
}
