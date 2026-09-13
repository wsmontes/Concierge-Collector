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
  return (
    <div className={`admin-notice admin-notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="admin-notice__content">
        <Banner type={tone}>{children}</Banner>
      </div>
      {action && <div className="admin-notice__action">{action}</div>}
    </div>
  )
}
