import type { ReactNode } from 'react'

/**
 * Aviso inline. `error` continua sendo `role="alert"` e todo o resto
 * `role="status"`: o erro interrompe a leitura, a informação não — e essa é a
 * única diferença que importa para um leitor de tela.
 */
export function InlineNotice({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error'
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="ui-notice" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="ui-notice__content">{children}</div>
      {action && <div>{action}</div>}
    </div>
  )
}

