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
