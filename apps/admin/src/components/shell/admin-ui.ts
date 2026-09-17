/**
 * Contexto de UI do Admin: uma casa para os overlays globais (paleta de
 * comandos e ajuda de atalhos) e para o tema.
 *
 * Existe porque a casca tem vários gatilhos para a mesma ação — a pílula de
 * busca na navegação, o botão no cabeçalho e o atalho ⌘K — e três estados
 * independentes dariam três paletas abertas ao mesmo tempo. O provedor mora em
 * `admin.components.providers`, que envolve a árvore inteira do admin: fora de
 * qualquer container `inert`, ao contrário da navegação (quando a sidebar está
 * fechada, tudo dentro dela recusa foco).
 */
export interface AdminUiContextValue {
  openPalette: () => void
  openShortcuts: () => void
}

export const ADMIN_UI_FALLBACK: AdminUiContextValue = {
  openPalette: () => {},
  openShortcuts: () => {},
}

export interface ShortcutSpec {
  keys: string
  description: string
}

/**
 * Os atalhos que existem de fato. Cada linha aqui é um atalho implementado — se
 * um atalho sai do código, sai daqui, senão a ajuda vira propaganda enganosa.
 */
export const ADMIN_SHORTCUTS: ShortcutSpec[] = [
  { keys: '⌘K / Ctrl+K', description: 'Abrir a paleta de comandos e busca' },
  { keys: '↑ ↓', description: 'Mover entre os resultados' },
  { keys: 'Enter', description: 'Abrir o resultado selecionado' },
  { keys: 'Esc', description: 'Fechar o overlay atual' },
  { keys: 'a', description: 'Marcar todas as linhas carregadas (fora de um campo de texto)' },
  { keys: '?', description: 'Mostrar esta lista' },
]
