'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { ADMIN_SHORTCUTS, type AdminUiContextValue } from './admin-ui'
import { AdminUiContext } from './AdminUiContext'
import { ShortcutsDialog } from './ShortcutsDialog'
import { GlobalSearch } from '../search/GlobalSearch'

/**
 * Providers do Admin — e a casa dos overlays globais.
 *
 * A paleta de comandos NÃO pode morar dentro da navegação: o `NavWrapper` marca
 * a sidebar como `inert` enquanto ela está fechada e nada dentro de um subtree
 * inert aceita foco (medido em browser real, a 390 px e a 1440 px: o elemento
 * ativo continuava sendo o `body` e `input.focus()` não fazia nada). Aqui ela é
 * montada uma vez, envolvendo a árvore inteira do admin, fora de qualquer inert.
 *
 * Antes de autenticar não há paleta: ela busca registros do CMS atrás da sessão,
 * então no login só sobraria um atalho que falha.
 */
export function CmsProviders({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const openShortcuts = useCallback(() => setShortcutsOpen(true), [])
  const value = useMemo<AdminUiContextValue>(() => ({ openPalette, openShortcuts }), [openPalette, openShortcuts])

  // A paleta pressupõe sessão: `/admin/login` é a única rota onde ela não faz
  // sentido. `usePathname` (e não `window.location`) para não divergir entre o
  // render do servidor e a hidratação.
  const pathname = usePathname()
  const signedIn = !pathname?.startsWith('/admin/login')

  /**
   * `?` abre a ajuda de atalhos. O guarda de alvo editável é o mesmo do atalho
   * `a` da lista: dentro de um campo de texto, uma tecla é texto — inclusive `?`.
   */
  useEffect(() => {
    if (!signedIn) return undefined
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      setShortcutsOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [signedIn])

  return (
    <AdminUiContext.Provider value={value}>
      {children}
      {signedIn && (
        <>
          <GlobalSearch onOpenChange={setPaletteOpen} open={paletteOpen} />
          <ShortcutsDialog onClose={() => setShortcutsOpen(false)} open={shortcutsOpen} shortcuts={ADMIN_SHORTCUTS} />
        </>
      )}
    </AdminUiContext.Provider>
  )
}
