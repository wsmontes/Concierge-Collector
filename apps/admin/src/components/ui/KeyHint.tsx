/**
 * Tecla de atalho. Existe para que o atalho seja descoberto no lugar onde ele
 * age (na busca, no botão de tema) em vez de só num help escondido.
 */
export function KeyHint({ children }: { children: string }) {
  return <kbd className="ui-keyhint">{children}</kbd>
}
