'use client'

import { Pill } from '@payloadcms/ui'

const SUCCESS = new Set(['published', 'completed', 'clean', 'success', 'ready', 'active'])
const WARNING = new Set(['dirty', 'publishing', 'queued', 'pending', 'running'])
const ERROR = new Set(['failed', 'error', 'conflicted', 'authorization_revoked'])
const MUTED = new Set(['archived', 'cancelled', 'stale', 'revoked', 'suspended'])

function pillStyle(status: string): 'success' | 'warning' | 'error' | 'light-gray' | 'light' {
  if (SUCCESS.has(status)) return 'success'
  if (WARNING.has(status)) return 'warning'
  if (ERROR.has(status)) return 'error'
  if (MUTED.has(status)) return 'light-gray'
  return 'light'
}

function defaultLabel(status: string): string {
  return status
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase())
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span className="admin-status" data-status={status}>
      <Pill pillStyle={pillStyle(status)} rounded size="small">{label ?? defaultLabel(status)}</Pill>
    </span>
  )
}
