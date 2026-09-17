import type { ReactNode } from 'react'

/**
 * Chip e pílula de status — a única forma de mostrar estado no Admin.
 *
 * Antes havia duas: o `Pill` do Payload (usado por `StatusPill`) e pílulas
 * próprias em cada lista, com o tom decidido por conta de cada tela. Aqui o tom
 * vem de um vocabulário semântico (papel, não hex) e o `data-status` continua no
 * elemento externo, que é o contrato que os testes e as telas já usavam.
 */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'error' | 'info' | 'muted'

const SUCCESS: Record<string, true> = {
  published: true,
  completed: true,
  clean: true,
  success: true,
  ready: true,
  active: true,
  applied: true,
  authorized: true,
}
const WARNING: Record<string, true> = {
  dirty: true,
  publishing: true,
  queued: true,
  pending: true,
  running: true,
  materializing: true,
  committing: true,
  staging: true,
}
const ERROR: Record<string, true> = {
  failed: true,
  error: true,
  conflicted: true,
  authorization_revoked: true,
}
const MUTED: Record<string, true> = {
  archived: true,
  cancelled: true,
  stale: true,
  revoked: true,
  suspended: true,
  expired: true,
}

/** Traduz um estado do domínio para um papel de cor. */
export function statusTone(status: string): Tone {
  if (SUCCESS[status]) return 'success'
  if (WARNING[status]) return 'warning'
  if (ERROR[status]) return 'error'
  if (MUTED[status]) return 'muted'
  return 'neutral'
}

export function Chip({
  children,
  tone = 'neutral',
  size = 'md',
  count,
  title,
  className = '',
}: {
  children: ReactNode
  tone?: Tone
  size?: 'sm' | 'md'
  count?: number
  title?: string
  className?: string
}) {
  return (
    <span
      className={`ui-chip ${size === 'sm' ? 'ui-chip--sm' : ''} ${className}`.trim()}
      data-tone={tone}
      title={title}
    >
      {children}
      {count !== undefined && <span className="ui-chip__count">{count}</span>}
    </span>
  )
}

/** Rótulo legível para um slug de domínio: `authorization_revoked` → `Authorization Revoked`. */
export function humanizeStatus(status: string): string {
  return status
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase())
}
