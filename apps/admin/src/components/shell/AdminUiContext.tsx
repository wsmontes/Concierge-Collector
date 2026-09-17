'use client'

import { createContext, useContext } from 'react'
import { ADMIN_UI_FALLBACK, type AdminUiContextValue } from './admin-ui'

/**
 * Contexto dos overlays globais. Vive num módulo próprio (e não junto do
 * provedor) para que quem consome — a navegação, as ações do cabeçalho — não
 * importe o componente que monta a paleta: importar o provedor de dentro de um
 * filho dele seria um ciclo.
 */
export const AdminUiContext = createContext<AdminUiContextValue>(ADMIN_UI_FALLBACK)

/** Acesso aos overlays globais da casca (paleta de comandos e ajuda de atalhos). */
export function useAdminUi(): AdminUiContextValue {
  return useContext(AdminUiContext)
}
