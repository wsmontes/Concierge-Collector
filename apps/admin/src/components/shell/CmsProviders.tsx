'use client'

import type { ReactNode } from 'react'
import { GlobalSearch } from '../search/GlobalSearch'

/**
 * Admin-wide providers.
 *
 * A global command palette cannot live inside the navigation subtree: Payload's
 * `NavWrapper` marks the sidebar `inert` while it is closed, and everything
 * inside an inert subtree refuses focus — the palette rendered there opened but
 * could never receive a keystroke (measured in a real browser at both 390 px and
 * 1440 px). `admin.components.providers` wraps the whole admin tree instead, so
 * the palette is mounted once, outside any inert container, and stays reachable
 * from every screen.
 */
export function CmsProviders({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <GlobalSearch />
    </>
  )
}
