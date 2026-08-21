export interface RetentionPolicy {
  loginStateTtlMinutes: number
  sessionTtlHours: number
  unusedSelectionTtlHours: number
  heartbeatTtlDays: number
  exportTtlDays: number
  operationItemRetentionDays: number
  orphanStagingRetentionDays: number
  auditRetentionDays: number
}

export const DEFAULT_RETENTION_POLICY: Readonly<RetentionPolicy> = Object.freeze({
  loginStateTtlMinutes: 10,
  sessionTtlHours: 8,
  unusedSelectionTtlHours: 24,
  heartbeatTtlDays: 7,
  exportTtlDays: 7,
  operationItemRetentionDays: 90,
  orphanStagingRetentionDays: 30,
  auditRetentionDays: 365,
})

const ENV_MAP: Record<keyof RetentionPolicy, string> = {
  loginStateTtlMinutes: 'CMS_LOGIN_STATE_TTL_MINUTES',
  sessionTtlHours: 'CMS_SESSION_TTL_HOURS',
  unusedSelectionTtlHours: 'CMS_UNUSED_SELECTION_TTL_HOURS',
  heartbeatTtlDays: 'CMS_HEARTBEAT_TTL_DAYS',
  exportTtlDays: 'CMS_EXPORT_TTL_DAYS',
  operationItemRetentionDays: 'CMS_OPERATION_ITEM_RETENTION_DAYS',
  orphanStagingRetentionDays: 'CMS_ORPHAN_STAGING_RETENTION_DAYS',
  auditRetentionDays: 'CMS_AUDIT_RETENTION_DAYS',
}

function positiveInt(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

/**
 * Versioned retention defaults. Staging/test may shorten windows to exercise
 * cleanup paths. Production can only keep or increase the checked-in defaults;
 * shortening them requires a reviewed source change rather than an env typo.
 */
export function readRetentionPolicy(env: NodeJS.ProcessEnv = process.env): RetentionPolicy {
  const environment = env.ENVIRONMENT?.trim().toLowerCase() || 'development'
  const policy = {} as RetentionPolicy
  for (const key of Object.keys(ENV_MAP) as Array<keyof RetentionPolicy>) {
    const name = ENV_MAP[key]
    const fallback = DEFAULT_RETENTION_POLICY[key]
    const value = positiveInt(env[name], name, fallback)
    if (environment === 'production' && value < fallback) {
      throw new Error(`${name} cannot be shorter than the versioned production default (${fallback})`)
    }
    policy[key] = value
  }
  return policy
}

export function cutoff(now: Date, amount: number, unit: 'minutes' | 'hours' | 'days'): Date {
  const multiplier = unit === 'minutes' ? 60_000 : unit === 'hours' ? 3_600_000 : 86_400_000
  return new Date(now.getTime() - amount * multiplier)
}
