'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
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
 *
 * Menos no login: a paleta busca registros do CMS atrás da sessão, então antes
 * de autenticar ela só deixava um gatilho solto e um atalho que falha. Ali o
 * que importa é entrar.
 */
export function CmsProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const signedIn = !pathname?.startsWith('/admin/login')

  return (
    <>
      {children}
      {signedIn && <GlobalSearch />}
    </>
  )
}
