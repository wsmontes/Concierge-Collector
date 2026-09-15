'use client'

import type { MouseEvent, ReactNode } from 'react'

/** Told where the reader wants to go; the default leaves the anchor's own href alone. */
export type CurationNavigate = (href: string) => void

/** Leaves the shell to the browser — the Admin view is not a router here. */
export function navigateInBrowser(href: string) {
  if (typeof window === 'undefined') return
  window.location.assign(href)
}

/**
 * One navigation affordance for the whole page. The href is always real, so the
 * link works with middle-click, copy-link and no JavaScript; when the caller
 * injects a navigator the click is handed to it instead.
 */
export function CurationLink({
  href,
  navigate,
  children,
  className,
}: {
  href: string
  navigate?: CurationNavigate
  children: ReactNode
  className?: string
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (navigate === undefined) return
    event.preventDefault()
    navigate(href)
  }

  return <a className={className} href={href} onClick={handleClick}>{children}</a>
}
