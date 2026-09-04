export const ADMIN_ERROR_STATUSES = [400, 401, 403, 404, 409, 410, 412, 423, 503] as const

export type AdminErrorStatus = (typeof ADMIN_ERROR_STATUSES)[number]

const DEFAULT_CODES: Record<AdminErrorStatus, string> = {
  400: 'invalid_request',
  401: 'authentication_required',
  403: 'authorization_denied',
  404: 'not_found',
  409: 'conflict',
  410: 'selection_expired',
  412: 'precondition_failed',
  423: 'locked',
  503: 'service_unavailable',
}

const ADMIN_ERROR_CODES = {
  invalid_request: 400,
  collection_not_grantable: 400,
  authentication_required: 401,
  authorization_denied: 403,
  authorization_revoked: 403,
  csrf_origin_invalid: 403,
  not_found: 404,
  conflict: 409,
  idempotency_conflict: 409,
  unavailable_confirmation_required: 409,
  selection_expired: 410,
  revision_conflict: 412,
  precondition_failed: 412,
  locked: 423,
  draft_locked: 423,
  authorization_unavailable: 503,
  service_unavailable: 503,
  feature_disabled: 503,
} as const

type AdminErrorCode = keyof typeof ADMIN_ERROR_CODES

export class AdminHttpError extends Error {
  constructor(
    readonly status: AdminErrorStatus,
    readonly code: AdminErrorCode = DEFAULT_CODES[status] as AdminErrorCode,
    readonly details?: Record<string, string>,
  ) {
    super(code)
  }
}

function errorShape(error: unknown): { code: string; details?: Record<string, string>; status: AdminErrorStatus } | null {
  if (!(error instanceof AdminHttpError)) return null

  const { code, details, status } = error
  if (ADMIN_ERROR_CODES[code] !== status) return null

  return { code, details, status }
}

/** Formats every administrative failure without leaking internal exception details. */
export function adminErrorResponse(error: unknown): Response {
  const known = errorShape(error)
  const status = known?.status ?? 503
  const code = known?.code ?? DEFAULT_CODES[503]

  return Response.json(
    { error: { code, ...(known?.details ?? {}) } },
    { status, headers: { 'Cache-Control': 'private, no-store' } },
  )
}
