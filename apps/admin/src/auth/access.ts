export interface CmsAuthView {
  authorized?: boolean
  role?: string
}

export const isAuthenticated = (user: unknown): boolean => Boolean(user)

export const isAuthorizedAdmin = (user: unknown): boolean => {
  if (!user || typeof user !== 'object') return false

  const authView = user as CmsAuthView
  return authView.role === 'admin' && authView.authorized === true
}

/**
 * Browser origins allowed by Payload CORS. Collector origins are explicit
 * deployment configuration; no wildcard is permitted.
 */
export function approvedBrowserOrigins(adminOrigin: string, collectorOrigins: readonly string[]): string[] {
  return [...new Set([adminOrigin, ...collectorOrigins])]
}
