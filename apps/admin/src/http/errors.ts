export const ADMIN_ERROR_STATUSES = [401, 403, 409, 412, 423, 503] as const

export type AdminErrorStatus = (typeof ADMIN_ERROR_STATUSES)[number]

const DEFAULT_CODES: Record<AdminErrorStatus, string> = {
  401: 'authentication_required',
  403: 'authorization_denied',
  409: 'conflict',
  412: 'precondition_failed',
  423: 'locked',
  503: 'service_unavailable',
}

const ADMIN_ERROR_CODES = {
  authentication_required: 401,
  authorization_denied: 403,
  authorization_revoked: 403,
  csrf_origin_invalid: 403,
  conflict: 409,
  revision_conflict: 409,
  precondition_failed: 412,
  locked: 423,
  draft_locked: 423,
  authorization_unavailable: 503,
  service_unavailable: 503,
} as const

type AdminErrorCode = keyof typeof ADMIN_ERROR_CODES

export class AdminHttpError extends Error {
  constructor(
    readonly status: AdminErrorStatus,
    readonly code: AdminErrorCode = DEFAULT_CODES[status] as AdminErrorCode,
  ) {
    super(code)
  }
}

function errorShape(error: unknown): { code: string; status: AdminErrorStatus } | null {
  if (!(error instanceof AdminHttpError)) return null

  const { code, status } = error
  if (ADMIN_ERROR_CODES[code] !== status) return null

  return { code, status }
}

/** Formats every administrative failure without leaking internal exception details. */
export function adminErrorResponse(error: unknown): Response {
  const known = errorShape(error)
  const status = known?.status ?? 503
  const code = known?.code ?? DEFAULT_CODES[503]

  return Response.json({ error: { code } }, { status })
}
